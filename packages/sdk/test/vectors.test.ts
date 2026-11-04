import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import {
  allocateJlendIx,
  allocateKaminoIxs,
  ata,
  depositIx,
  initVaultIx,
  openInboxIx,
  redeemIxs,
  refreshReserveIx,
  setWeightsIx,
  sweepInboxIx,
  syncNavIx,
  USDC_MINT,
  vaultAddresses,
} from "../src/index.js";

// Produced by `cargo test -p landfall --test client_vectors` from the program's own Anchor client types.
const vectors = JSON.parse(readFileSync(resolve(import.meta.dirname, "vectors.json"), "utf8"));
const v = vaultAddresses();
const pk = (s: string) => new PublicKey(s);
const [admin, user, owner, keeper] = ["admin", "user", "owner", "keeper"].map((k) => pk(vectors[k]));
const dest = ata(user, USDC_MINT);

const enc = (ix: TransactionInstruction) => ({
  data: Buffer.from(ix.data).toString("hex"),
  keys: ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]),
});

const cases: [string, () => TransactionInstruction][] = [
  ["deposit", () => depositIx(v, user, owner, 1_234_567)],
  ["open_inbox", () => openInboxIx(v, keeper, owner)],
  ["sweep_inbox", () => sweepInboxIx(v, keeper, owner)],
  ["allocate_kamino", () => allocateKaminoIxs(v, keeper, 5_000_000)[1]],
  ["allocate_jlend", () => allocateJlendIx(v, keeper, 4_000_000)],
  ["sync_nav", () => syncNavIx(v)],
  ["redeem", () => redeemIxs(v, user, dest, 3_000_000, 2_990_000, "idle")[0]],
  ["redeem_via_kamino", () => redeemIxs(v, user, dest, 3_000_000, 2_990_000, "kamino")[1]],
  ["redeem_via_jlend", () => redeemIxs(v, user, dest, 3_000_000, 2_990_000, "jupiter-lend")[0]],
  ["refresh_reserve", () => refreshReserveIx()],
  ["set_weights", () => setWeightsIx(v, admin, 6000, 4000, 77n, 88n)],
  ["init_vault", () => initVaultIx(v, admin, { curator: admin, idleBufferBps: 1000, sweepFee: 10_000n, minSweep: 1_000_000n, seedAmount: 1_000_000n })],
];

describe("SDK instructions match the program's Anchor client byte for byte", () => {
  for (const [name, build] of cases) {
    it(name, () => expect(enc(build())).toEqual(vectors[name]));
  }
});
