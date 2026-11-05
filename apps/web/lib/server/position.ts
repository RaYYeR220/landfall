import "server-only";
import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { ata, inboxAddresses, readNav, type Nav } from "@landfall/sdk";
import { connection, vault } from "./env";

// ---- yields (public APIs, cached) ----
let apyCache: { at: number; kamino: number; jupiterLend: number } | undefined;
export const strategyApy = async () => {
  if (apyCache && Date.now() - apyCache.at < 5 * 60_000) return apyCache;
  const [k, j] = await Promise.all([
    fetch("https://api.kamino.finance/kamino-market/7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF/reserves/metrics")
      .then((r) => r.json() as Promise<{ reserve: string; supplyApy: string }[]>)
      .then((rs) => Number(rs.find((r) => r.reserve === "D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59")?.supplyApy ?? 0))
      .catch(() => 0),
    fetch("https://lite-api.jup.ag/lend/v1/earn/tokens")
      .then((r) => r.json() as Promise<{ assetAddress: string; totalRate: string }[]>)
      .then((ts) => Number(ts.find((t) => t.assetAddress === "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")?.totalRate ?? 0) / 10_000)
      .catch(() => 0),
  ]);
  apyCache = { at: Date.now(), kamino: k, jupiterLend: j };
  return apyCache;
};

const n = (x: bigint) => Number(x) / 1e6;

export const vaultSummary = async () => {
  const [nav, apy] = await Promise.all([readNav(connection(), vault), strategyApy()]);
  const total = n(nav.total) || 1;
  const blended = (n(nav.kamino) * apy.kamino + n(nav.jupiterLend) * apy.jupiterLend) / total;
  return {
    vault: vault.vault.toBase58(),
    shareMint: vault.shareMint.toBase58(),
    programId: vault.programId.toBase58(),
    nav: { total: n(nav.total), idle: n(nav.idle), kamino: n(nav.kamino), jupiterLend: n(nav.jupiterLend) },
    sharePrice: n(nav.sharePrice1e6),
    shareSupply: n(nav.shareSupply),
    apy: { kamino: apy.kamino, jupiterLend: apy.jupiterLend, blended },
    weights: { kamino: nav.vault.kamino.weightBps / 100, jupiterLend: nav.vault.jlend.weightBps / 100, idleBuffer: nav.vault.idleBufferBps / 100 },
    caps: { kamino: n(nav.vault.kamino.cap), jupiterLend: n(nav.vault.jlend.cap) },
    paused: nav.vault.paused,
    landed: { total: n(nav.vault.landedTotal), count: Number(nav.vault.landedCount) },
    redeemed: n(nav.vault.redeemedTotal),
    curator: nav.vault.curator.toBase58(),
    admin: nav.vault.admin.toBase58(),
    params: { sweepFee: n(nav.vault.sweepFee), minSweep: n(nav.vault.minSweep), idleBufferBps: nav.vault.idleBufferBps },
    strategies: {
      kamino: { enabled: nav.vault.kamino.enabled, configured: !nav.vault.kamino.reserve.equals(PublicKey.default), cachedValue: n(nav.vault.kamino.cachedValue), cachedSlot: Number(nav.vault.kamino.cachedSlot) },
      jupiterLend: { enabled: nav.vault.jlend.enabled, configured: !nav.vault.jlend.lending.equals(PublicKey.default), cachedValue: n(nav.vault.jlend.cachedValue), cachedSlot: Number(nav.vault.jlend.cachedSlot) },
    },
  };
};

export const position = async (owner: PublicKey) => {
  const ib = inboxAddresses(vault, owner);
  const usdc = ata(owner, vault.usdcMint);
  const [nav, infos] = await Promise.all([
    readNav(connection(), vault),
    connection().getMultipleAccountsInfo([ib.ownerShares, ib.inboxUsdc, usdc, ib.inbox], "confirmed"),
  ]);
  const amt = (i: number) => (infos[i] && infos[i]!.data.length >= 72 ? Buffer.from(infos[i]!.data).readBigUInt64LE(64) : 0n);
  const shares = amt(0);
  const value = (shares * nav.sharePrice1e6) / 1_000_000n;
  return {
    owner: owner.toBase58(),
    shares: n(shares),
    value: n(value),
    sharePrice: n(nav.sharePrice1e6),
    inbox: { address: ib.inbox.toBase58(), usdcAccount: ib.inboxUsdc.toBase58(), exists: Boolean(infos[3]), pendingUsdc: n(amt(1)) },
    /** USDC sitting in the owner account itself — for an intermediary, leftovers to recover. */
    looseUsdc: n(amt(2)),
  };
};

// ---- on-chain history (Anchor events in program logs) ----
const eventDisc = (name: string) => createHash("sha256").update(`event:${name}`).digest().subarray(0, 8);
const LANDED = eventDisc("Landed");
const REDEEMED = eventDisc("Redeemed");

export type ChainEvent =
  | { kind: "landed"; signature: string; slot: number; time: number | null; source: "direct" | "inbox"; amount: number; shares: number; depositor: string }
  | { kind: "redeemed"; signature: string; slot: number; time: number | null; amount: number; shares: number; destination: string };

const decode = (signature: string, slot: number, time: number | null, b64: string): ChainEvent | null => {
  const d = Buffer.from(b64, "base64");
  if (d.length < 8) return null;
  const disc = d.subarray(0, 8);
  if (disc.equals(LANDED)) {
    const o = 8;
    return {
      kind: "landed", signature, slot, time,
      depositor: new PublicKey(d.subarray(o + 64, o + 96)).toBase58(),
      source: d[o + 96] === 1 ? "inbox" : "direct",
      amount: n(d.readBigUInt64LE(o + 97)),
      shares: n(d.readBigUInt64LE(o + 105)),
    };
  }
  if (disc.equals(REDEEMED)) {
    const o = 8;
    return {
      kind: "redeemed", signature, slot, time,
      destination: new PublicKey(d.subarray(o + 64, o + 96)).toBase58(),
      shares: n(d.readBigUInt64LE(o + 96)),
      amount: n(d.readBigUInt64LE(o + 104)),
    };
  }
  return null;
};

export const chainHistory = async (owner: PublicKey, limit = 15): Promise<ChainEvent[]> => {
  const shares = ata(owner, vault.shareMint);
  const sigs = await connection().getSignaturesForAddress(shares, { limit }, "confirmed").catch(() => []);
  const txs = await connection().getTransactions(sigs.map((s) => s.signature), { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  const out: ChainEvent[] = [];
  txs.forEach((tx, i) => {
    for (const line of tx?.meta?.logMessages ?? []) {
      if (!line.startsWith("Program data: ")) continue;
      const ev = decode(sigs[i].signature, sigs[i].slot, sigs[i].blockTime ?? null, line.slice(14));
      if (ev) out.push(ev);
    }
  });
  return out;
};

export type { Nav };
