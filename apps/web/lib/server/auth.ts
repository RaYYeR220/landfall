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
    const ok = await verifyMessage({ address: p.wallet as `0x${string}`, message, signature: p.signature as `0x${string}` });
    if (!ok) throw Object.assign(new Error("bad signature"), { status: 401 });
    // an EVM wallet owns its vault shares through its Intents Connect Solana intermediary
    const inter = await connectApi().getIntermediary(p.wallet);
    if (inter.solana !== p.owner) throw Object.assign(new Error("owner is not this wallet's Solana intermediary"), { status: 403 });
    return new PublicKey(p.owner);
  }

  const wallet = new PublicKey(p.wallet);
  const sig = p.signature.startsWith("0x") ? Buffer.from(p.signature.slice(2), "hex") : bs58.decode(p.signature);
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

export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
