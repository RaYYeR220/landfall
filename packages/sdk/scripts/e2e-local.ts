/**
 * End-to-end run of the SDK against a local validator that carries the
 * program plus mainnet snapshots of Kamino and Jupiter Lend
 * (`scripts/local-validator.sh`). Exercises every instruction builder.
 *
 *   pnpm --filter @landfall/sdk e2e:local
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction, Transaction, TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createMintToInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  allocateJlendIx,
  allocateKaminoIxs,
  ata,
  configureJlendIx,
  configureKaminoIx,
  createAtaIdempotentIx,
  depositIx,
  initVaultIx,
  inboxAddresses,
  openInboxIx,
  readNav,
  redeemIxs,
  setWeightsIx,
  sweepInboxIx,
  syncNavIx,
  USDC_MINT,
  vaultAddresses,
} from "../src/index";

const ROOT = resolve(import.meta.dirname, "../../..");
const conn = new Connection(process.env.RPC ?? "http://127.0.0.1:8899", "confirmed");
const usdcAuthority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(resolve(ROOT, "target/e2e/usdc-authority.json"), "utf8"))));
const v = vaultAddresses();
const fmt = (x: bigint) => (Number(x) / 1e6).toFixed(6);

const send = async (label: string, ixs: TransactionInstruction[], signers: Keypair[]) => {
  const tx = new Transaction().add(...ixs);
  const sig = await sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" });
  const meta = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  console.log(`✓ ${label.padEnd(34)} ${meta?.meta?.computeUnitsConsumed ?? "?"} CU  ${sig.slice(0, 16)}…`);
  return sig;
};

const funded = async () => {
  const k = Keypair.generate();
  const sig = await conn.requestAirdrop(k.publicKey, 5 * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, "confirmed");
  return k;
};

const mintUsdc = async (payer: Keypair, owner: PublicKey, amount: bigint, allowOffCurve = false) => {
  const dst = getAssociatedTokenAddressSync(USDC_MINT, owner, allowOffCurve);
  await send(`mint ${fmt(amount)} test USDC`, [
    createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, dst, owner, USDC_MINT),
    createMintToInstruction(USDC_MINT, dst, usdcAuthority.publicKey, amount),
  ], [payer, usdcAuthority]);
  return dst;
};

const balance = async (a: PublicKey) => BigInt((await conn.getTokenAccountBalance(a).catch(() => ({ value: { amount: "0" } }))).value.amount);

const assert = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
};

const main = async () => {
  const admin = await funded();
  await mintUsdc(admin, admin.publicKey, 2_000_000n);
  await send("init_vault", [initVaultIx(v, admin.publicKey, { curator: admin.publicKey, idleBufferBps: 1000, sweepFee: 10_000n, minSweep: 1_000_000n, seedAmount: 1_000_000n })], [admin]);
  await send("configure_kamino", [configureKaminoIx(v, admin.publicKey, true)], [admin]);
  await send("configure_jlend", [configureJlendIx(v, admin.publicKey, true)], [admin]);
  await send("set_weights 60/40", [setWeightsIx(v, admin.publicKey, 6000, 4000, 2n ** 63n, 2n ** 63n)], [admin]);

  // wallet landing
  const alice = await funded();
  await mintUsdc(alice, alice.publicKey, 100_000_000n);
  await send("deposit 100 USDC (wallet)", [createAtaIdempotentIx(alice.publicKey, alice.publicKey, v.shareMint), depositIx(v, alice.publicKey, alice.publicKey, 100_000_000n)], [alice]);
  const aliceShares = await balance(ata(alice.publicKey, v.shareMint));
  assert(aliceShares === 100_000_000n, `alice shares ${aliceShares}`);

  // persistent-address landing: USDC arrives in an inbox, a keeper sweeps it
  const keeper = await funded();
  await mintUsdc(keeper, keeper.publicKey, 0n);
  const owner = Keypair.generate().publicKey;
  await send("open_inbox", [openInboxIx(v, keeper.publicKey, owner)], [keeper]);
  const ib = inboxAddresses(v, owner);
  await mintUsdc(keeper, ib.inbox, 20_000_000n, true);
  await send("sweep_inbox 20 USDC", [sweepInboxIx(v, keeper.publicKey, owner)], [keeper]);
  const ownerShares = await balance(ib.ownerShares);
  assert(ownerShares > 19_980_000n, `owner shares ${ownerShares}`);

  // allocation by the keeper
  await send("allocate_kamino 60 USDC", allocateKaminoIxs(v, keeper.publicKey, 60_000_000n), [keeper]);
  await send("allocate_jlend 40 USDC", [allocateJlendIx(v, keeper.publicKey, 40_000_000n)], [keeper]);
  await send("sync_nav", [syncNavIx(v)], [keeper]);

  const nav = await readNav(conn, v);
  console.log(`  NAV ${fmt(nav.total)} = idle ${fmt(nav.idle)} + Kamino ${fmt(nav.kamino)} + Jupiter Lend ${fmt(nav.jupiterLend)} · share price ${fmt(nav.sharePrice1e6)}`);
  assert(nav.total > 120_990_000n && nav.total <= 121_000_000n, `nav ${nav.total}`);
  assert(nav.vault.landedCount === 2n, "landed count");

  // redemptions pull from each strategy
  const dest = ata(alice.publicKey, USDC_MINT);
  await send("redeem 40 lfUSDC via Kamino", redeemIxs(v, alice.publicKey, dest, 40_000_000n, 39_990_000n, "kamino"), [alice]);
  await send("redeem 40 lfUSDC via Jupiter Lend", redeemIxs(v, alice.publicKey, dest, 40_000_000n, 39_990_000n, "jupiter-lend"), [alice]);
  await send("redeem 10 lfUSDC from idle", redeemIxs(v, alice.publicKey, dest, 10_000_000n, 9_990_000n, "idle"), [alice]);
  const got = await balance(dest);
  console.log(`  alice received ${fmt(got)} USDC for 90 lfUSDC`);
  assert(got >= 89_970_000n && got <= 90_000_000n, `alice got ${got}`);
  console.log("e2e: all good");
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
