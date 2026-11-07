/**
 * The permissionless crank: sweep every inbox that a persistent deposit
 * address has paid, then move spare idle USDC toward the curator's weights.
 * Anyone can run it; Landfall runs it as a service and on demand from the app.
 */
import { Buffer } from "buffer";
import { Connection, Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha256";
import { createAtaIdempotentIx, allocateJlendIx, allocateKaminoIxs, sweepInboxIx, syncNavIx } from "./ix";
import { inboxAddresses, type VaultAddresses } from "./pda";
import { decodeInbox, readNav, type Nav } from "./state";
import { sendReliably } from "./send";

const INBOX_DISCRIMINATOR = Buffer.from(sha256(new TextEncoder().encode("account:Inbox"))).subarray(0, 8);
const INBOX_SIZE = 8 + 32 + 32 + 8 + 8 + 8 + 1;

export type CrankAction =
  | { kind: "sweep"; owner: string; amount: bigint; signature: string }
  | { kind: "allocate"; strategy: "kamino" | "jupiter-lend"; amount: bigint; signature: string }
  | { kind: "sync"; signature: string }
  | { kind: "error"; step: string; message: string };

export type CrankOptions = {
  connection: Connection;
  keeper: Keypair;
  vault: VaultAddresses;
  /** Restrict sweeping to these owners (e.g. the user who just opened the app). */
  owners?: PublicKey[];
  /** Don't allocate amounts smaller than this (USDC base units). */
  minAllocation?: bigint;
  /** Micro-lamports per CU for priority fees. */
  priorityFee?: number;
  sync?: boolean;
};

export const listInboxes = async (connection: Connection, v: VaultAddresses) => {
  const accounts = await connection.getProgramAccounts(v.programId, {
    commitment: "confirmed",
    filters: [{ dataSize: INBOX_SIZE }, { memcmp: { offset: 0, bytes: INBOX_DISCRIMINATOR.toString("base64"), encoding: "base64" } }, { memcmp: { offset: 8, bytes: v.vault.toBase58() } }],
  });
  return accounts.map((a) => ({ address: a.pubkey, ...decodeInbox(Buffer.from(a.account.data)) }));
};

const send = async (o: CrankOptions, ixs: TransactionInstruction[]) => {
  return sendReliably(o.connection, ixs, [o.keeper], { computeUnits: 250_000, priorityFee: o.priorityFee ?? 50_000, attempts: 3 });
};

/** Which strategy is furthest below its target and how much it may take. */
export const nextAllocation = (nav: Nav, minAllocation: bigint) => {
  const v = nav.vault;
  if (v.paused) return null;
  const bps = (x: bigint, b: number) => (x * BigInt(b)) / 10_000n;
  const spare = nav.idle - bps(nav.total, v.idleBufferBps);
  if (spare < minAllocation) return null;
  const room = (current: bigint, weight: number, cap: bigint, enabled: boolean) => {
    if (!enabled) return 0n;
    const target = bps(nav.total, weight) - current;
    const capRoom = cap - current;
    const r = target < capRoom ? target : capRoom;
    return r > 0n ? r : 0n;
  };
  const k = room(nav.kamino, v.kamino.weightBps, v.kamino.cap, v.kamino.enabled);
  const j = room(nav.jupiterLend, v.jlend.weightBps, v.jlend.cap, v.jlend.enabled);
  const pick = k >= j ? { strategy: "kamino" as const, room: k } : { strategy: "jupiter-lend" as const, room: j };
  const amount = pick.room < spare ? pick.room : spare;
  return amount >= minAllocation ? { strategy: pick.strategy, amount } : null;
};

export const crankOnce = async (o: CrankOptions): Promise<CrankAction[]> => {
  const actions: CrankAction[] = [];
  const v = o.vault;
  const nav0 = await readNav(o.connection, v);

  // 1. sweeps
  const owners = o.owners ?? (await listInboxes(o.connection, v)).map((i) => i.owner);
  if (owners.length) {
    const balances = await o.connection.getMultipleAccountsInfo(owners.map((ow) => inboxAddresses(v, ow).inboxUsdc), "confirmed");
    for (const [i, owner] of owners.entries()) {
      const info = balances[i];
      const amount = info && info.data.length >= 72 ? Buffer.from(info.data).readBigUInt64LE(64) : 0n;
      if (amount === 0n || amount < nav0.vault.minSweep) continue;
      try {
        const signature = await send(o, [createAtaIdempotentIx(o.keeper.publicKey, o.keeper.publicKey, v.usdcMint), sweepInboxIx(v, o.keeper.publicKey, owner)]);
        actions.push({ kind: "sweep", owner: owner.toBase58(), amount, signature });
      } catch (e) {
        actions.push({ kind: "error", step: `sweep ${owner.toBase58()}`, message: (e as Error).message });
      }
    }
  }

  // 2. allocations (at most one per strategy per tick)
  const minAllocation = o.minAllocation ?? 2_000_000n;
  for (let round = 0; round < 2; round++) {
    const nav = await readNav(o.connection, v);
    const next = nextAllocation(nav, minAllocation);
    if (!next) break;
    try {
      const ixs = next.strategy === "kamino" ? allocateKaminoIxs(v, o.keeper.publicKey, next.amount) : [allocateJlendIx(v, o.keeper.publicKey, next.amount)];
      const signature = await send(o, ixs);
      actions.push({ kind: "allocate", strategy: next.strategy, amount: next.amount, signature });
    } catch (e) {
      actions.push({ kind: "error", step: `allocate ${next.strategy}`, message: (e as Error).message });
      break;
    }
  }

  // 3. refresh the landing fallback values
  if (o.sync) {
    try {
      actions.push({ kind: "sync", signature: await send(o, [syncNavIx(v)]) });
    } catch (e) {
      actions.push({ kind: "error", step: "sync_nav", message: (e as Error).message });
    }
  }
  return actions;
};

