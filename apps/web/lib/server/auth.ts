import "server-only";
import { ed25519 } from "@noble/curves/ed25519";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { verifyMessage } from "viem";
import { connectApi } from "./env";

/**
 * Proof that the caller controls the wallet behind a vault owner, required
 * before the keeper spends rent on that owner's inbox. The wallet signs a
 * short, dated, human-readable message (no transaction, no gas).
 */
export const ownershipMessage = (owner: string, issuedAt: string) =>
  `Landfall: open my deposit addresses\nOwner: ${owner}\nIssued: ${issuedAt}`;

const MAX_AGE_MS = 10 * 60_000;

export type OwnershipProof = { wallet: string; owner: string; issuedAt: string; signature: string };

export const verifyOwnership = async (p: OwnershipProof): Promise<PublicKey> => {
  const age = Date.now() - Date.parse(p.issuedAt);
  if (!(age >= -60_000 && age <= MAX_AGE_MS)) throw Object.assign(new Error("signature expired, sign again"), { status: 401 });
  const message = ownershipMessage(p.owner, p.issuedAt);

  if (/^0x[0-9a-fA-F]{40}$/.test(p.wallet)) {
    // Intents Connect envelope `secp256k1:<base58 r‖s‖v(0/1)>` or a plain 0x signature
    let sigHex = p.signature as `0x${string}`;
    if (p.signature.startsWith("secp256k1:")) {
      const raw = bs58.decode(p.signature.slice("secp256k1:".length));
      if (raw.length !== 65) throw Object.assign(new Error("bad signature"), { status: 401 });
      raw[64] = raw[64] < 27 ? raw[64] + 27 : raw[64];
      sigHex = `0x${Buffer.from(raw).toString("hex")}`;
    }
    const ok = await verifyMessage({ address: p.wallet as `0x${string}`, message, signature: sigHex });
    if (!ok) throw Object.assign(new Error("bad signature"), { status: 401 });
    // an EVM wallet owns its vault shares through its Intents Connect Solana intermediary
    const inter = await connectApi().getIntermediary(p.wallet);
    if (inter.solana !== p.owner) throw Object.assign(new Error("owner is not this wallet's Solana intermediary"), { status: 403 });
    return new PublicKey(p.owner);
  }

  const wallet = new PublicKey(p.wallet);
  const raw = p.signature.startsWith("ed25519:") ? p.signature.slice("ed25519:".length) : p.signature;
  const sig = raw.startsWith("0x") ? Buffer.from(raw.slice(2), "hex") : bs58.decode(raw);
  if (!ed25519.verify(sig, new TextEncoder().encode(message), wallet.toBytes())) throw Object.assign(new Error("bad signature"), { status: 401 });
  if (p.owner !== wallet.toBase58()) {
    const inter = await connectApi().getIntermediary(wallet.toBase58());
    if (inter.solana !== p.owner) throw Object.assign(new Error("owner is not controlled by this wallet"), { status: 403 });
  }
  return new PublicKey(p.owner);
};

/** Simple fixed-window limiter (per serverless instance). */
export const limiter = (max: number, windowMs: number) => {
  const hits = new Map<string, { n: number; at: number }>();
  return (key: string) => {
    const now = Date.now();
    const h = hits.get(key);
    if (!h || now - h.at > windowMs) {
      hits.set(key, { n: 1, at: now });
      if (hits.size > 5_000) hits.clear();
      return true;
    }
    h.n += 1;
    return h.n <= max;
  };
};

/**
 * Client IP as set by the hosting edge (Vercel sets `x-real-ip` and overwrites
 * `x-forwarded-for`); falls back to the last proxy hop, never a client-chosen
 * first entry. Per-IP limits are a secondary control: the primary bounds are
 * the signed ownership proof and the demo wallet's own balance.
 */
export const clientIp = (req: Request) =>
  req.headers.get("x-real-ip")?.trim() || req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "local";
