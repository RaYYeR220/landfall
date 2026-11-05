/**
 * End-to-end run on a mainnet fork (surfpool): the deployed program against
 * live Kamino and Jupiter Lend state, every user flow, the keeper, and the
 * Intents Connect steps executed the way the Aurora backend assembles them
 * (placeholders substituted, args Borsh-encoded after the discriminator).
 *
 *   scripts/fork.sh   (starts the fork, deploys, runs this)
 */
import { readFileSync } from "node:fs";
import { Buffer } from "buffer";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, sendAndConfirmTransaction, Transaction, TransactionInstruction } from "@solana/web3.js";
import type { SolanaStep } from "@aurora-is-near/intents-connect";
import {
  ata,
  bridgeInDepositSteps,
  configureJlendIx,
  configureKaminoIx,
  crankOnce,
  createAtaIdempotentIx,
  depositIx,
  finishIntoVaultSteps,
  inboxAddresses,
  initVaultIx,
  openInboxIx,
  readNav,
  redeemSourceFor,
  setParamsIx,
  setWeightsIx,
  strategyHealth,
  swapOutIxs,
  TOKEN_PROGRAM_ID,
  USDC_MINT,
  vaultAddresses,
  withdrawAnywhereSteps,
  withdrawToSolanaSteps,
} from "../src/index";

const conn = new Connection(process.env.RPC ?? "http://127.0.0.1:8899", "confirmed");
const key = (path: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
const admin = key(process.env.ADMIN_KEYPAIR!);
const keeper = key(process.env.KEEPER_KEYPAIR!);
const v = vaultAddresses();
const fmt = (x: bigint) => (Number(x) / 1e6).toFixed(6);
const results: { step: string; cu: number | null; signature: string }[] = [];

const send = async (label: string, ixs: TransactionInstruction[], signers: Keypair[]) => {
  const sig = await sendAndConfirmTransaction(conn, new Transaction().add(...ixs), signers, { commitment: "confirmed" });
  const meta = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  const cu = meta?.meta?.computeUnitsConsumed ?? null;
  results.push({ step: label, cu, signature: sig });
  console.log(`✓ ${label.padEnd(46)} ${String(cu ?? "?").padStart(6)} CU`);
  return sig;
};

const rpc = async (method: string, params: unknown[]) => {
  const res = await fetch(conn.rpcEndpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await res.json()) as { error?: { message: string }; result?: unknown };
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
};
/** surfpool cheatcode: give `owner` an exact USDC balance in its associated account. */
const setUsdc = (owner: PublicKey, amount: bigint) => rpc("surfnet_setTokenAccount", [owner.toBase58(), USDC_MINT.toBase58(), { amount: Number(amount) }, TOKEN_PROGRAM_ID.toBase58()]);
const fund = async (k: PublicKey) => conn.confirmTransaction(await conn.requestAirdrop(k, 2 * LAMPORTS_PER_SOL), "confirmed");
const balance = async (a: PublicKey) => BigInt((await conn.getTokenAccountBalance(a).catch(() => ({ value: { amount: "0" } }))).value.amount);
const assert = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
};

/** What the Intents Connect backend does with a Solana step. */
const encodeArg = (type: string, value: string) => {
  const n = BigInt(value);
  const width = { u8: 1, u16: 2, u32: 4, u64: 8, u128: 16 }[type];
  if (type === "pubkey") return new PublicKey(value).toBuffer();
  if (!width) throw new Error(`unsupported arg type ${type}`);
  const b = Buffer.alloc(width);
  for (let i = 0; i < width; i++) b[i] = Number((n >> BigInt(8 * i)) & 0xffn);
  return b;
};
const stepsToIxs = (steps: SolanaStep[], subs: Record<string, string>) =>
  steps.map(
    (s) =>
      new TransactionInstruction({
        programId: new PublicKey(s.programId),
        keys: s.accounts.map((a) => ({ pubkey: new PublicKey(subs[a.pubkey] ?? a.pubkey), isSigner: a.isSigner, isWritable: a.isWritable })),
        data: Buffer.concat([Buffer.from(s.discriminator ?? "", "hex"), ...(s.args ?? []).map((a) => encodeArg(a.type, subs[String(a.value)] ?? String(a.value)))]),
      }),
  );

const main = async () => {
  for (const k of [admin.publicKey, keeper.publicKey]) await fund(k);

  // --- set-up, as init-vault.ts does on mainnet
  if (!(await conn.getAccountInfo(v.vault))) {
    await setUsdc(admin.publicKey, 2_000_000n);
    await send("init_vault (seed 1 USDC)", [initVaultIx(v, admin.publicKey, { curator: admin.publicKey, idleBufferBps: 1000, sweepFee: 10_000n, minSweep: 1_000_000n, seedAmount: 1_000_000n })], [admin]);
  }
  await send("configure_kamino + configure_jlend", [configureKaminoIx(v, admin.publicKey, true), configureJlendIx(v, admin.publicKey, true)], [admin]);
  await send("set_weights 60/40 + params", [setWeightsIx(v, admin.publicKey, 6000, 4000, 5_000_000_000n, 5_000_000_000n), setParamsIx(v, admin.publicKey, 1000, 10_000n, 1_000_000n)], [admin]);

  // --- 1. Solana wallet deposit
  const alice = Keypair.generate();
  await fund(alice.publicKey);
  await setUsdc(alice.publicKey, 100_000_000n);
  await send("wallet deposit 100 USDC", [createAtaIdempotentIx(alice.publicKey, alice.publicKey, v.shareMint), depositIx(v, alice.publicKey, alice.publicKey, 100_000_000n)], [alice]);
  const aliceShares = await balance(ata(alice.publicKey, v.shareMint));
  assert(aliceShares > 99_000_000n, `alice shares ${aliceShares}`);

  // --- 2. Intents Connect bridge-in: the intermediary receives the bridged USDC and runs our steps
  const im = Keypair.generate();
  await fund(im.publicKey);
  await setUsdc(im.publicKey, 25_000_000n);
  const minAmountOut = 24_960_000n; // post-fee amount the service substitutes
  const landing = stepsToIxs(bridgeInDepositSteps(v, im.publicKey), { "{INTERMEDIARY}": im.publicKey.toBase58(), "{MIN_AMOUNT_OUT}": minAmountOut.toString() });
  await send("bridge-in landing (IC steps, {MIN_AMOUNT_OUT})", landing, [im]);
  const imShares = await balance(ata(im.publicKey, v.shareMint));
  assert(imShares > 24_000_000n, `intermediary shares ${imShares}`);
  assert((await balance(ata(im.publicKey, USDC_MINT))) === 40_000n, "the fee reserve stays in the intermediary");

  // --- 3. persistent address: Aurora pays the inbox, the keeper sweeps and allocates
  const owner = Keypair.generate().publicKey;
  await send("open_inbox (keeper pays rent)", [openInboxIx(v, keeper.publicKey, owner)], [keeper]);
  const ib = inboxAddresses(v, owner);
  await setUsdc(ib.inbox, 20_000_000n);
  for (let i = 0; i < 6; i++) {
    const actions = await crankOnce({ connection: conn, keeper, vault: v, owners: [owner], minAllocation: 1_000_000n });
    if (!actions.length) break;
    console.log(`  keeper tick ${i + 1}: ${actions.map((a) => (a.kind === "error" ? `error (${a.step}: ${a.message.slice(0, 160)})` : a.kind === "allocate" ? `allocate ${a.strategy} ${fmt(a.amount)}` : a.kind)).join(", ")}`);
  }
  const ownerShares = await balance(ib.ownerShares);
  assert(ownerShares > 19_700_000n, `inbox owner shares ${ownerShares}`);
  const nav = await readNav(conn, v);
  console.log(`  NAV ${fmt(nav.total)} = idle ${fmt(nav.idle)} + Kamino ${fmt(nav.kamino)} + Jupiter Lend ${fmt(nav.jupiterLend)} · price ${fmt(nav.sharePrice1e6)}`);
  assert(nav.kamino > 0n && nav.jupiterLend > 0n, "keeper allocated into both strategies");

  // --- 4. out-operation from the intermediary: redeem, then transfer to the 1Click deposit address's ATA
  const oneClick = Keypair.generate().publicKey;
  const outSteps = withdrawAnywhereSteps(v, im.publicKey, 10_000_000n, 9_950_000n, redeemSourceFor(nav, 10_000_000n));
  await send("out-operation (IC steps → {DEPOSIT_ADDRESS})", [
    createAtaIdempotentIx(im.publicKey, oneClick, USDC_MINT), // the service prepends this
    ...stepsToIxs(outSteps, { "{INTERMEDIARY}": im.publicKey.toBase58(), "{DEPOSIT_ADDRESS}": ata(oneClick, USDC_MINT).toBase58() }),
  ], [im]);
  assert((await balance(ata(oneClick, USDC_MINT))) === 9_950_000n, "deposit address received the quoted amount");

  // --- 5. steps-only withdrawal to any Solana address, from Kamino
  const bob = Keypair.generate().publicKey;
  const nav2 = await readNav(conn, v);
  const toBob = withdrawToSolanaSteps(v, im.publicKey, bob, 5_000_000n, 4_990_000n, nav2.kamino >= 5_000_000n ? "kamino" : redeemSourceFor(nav2, 5_000_000n), 4_990_000n);
  await send("steps-only withdraw to a Solana address", stepsToIxs(toBob, { "{INTERMEDIARY}": im.publicKey.toBase58() }), [im]);
  assert((await balance(ata(bob, USDC_MINT))) === 4_990_000n, "bob received USDC");

  // --- 6. Solana wallet → another chain: redeem and pay a Swap API deposit address in one transaction
  const swapDeposit = Keypair.generate().publicKey;
  const nav3 = await readNav(conn, v);
  await send("swap-out (one tx: redeem + pay 1Click)", swapOutIxs(v, alice.publicKey, 30_000_000n, 29_900_000n, redeemSourceFor(nav3, 30_000_000n), swapDeposit), [alice]);
  assert((await balance(ata(swapDeposit, USDC_MINT))) === 29_900_000n, "swap deposit address paid");

  // --- 7. recovery: USDC stranded in an intermediary is finished into the vault (steps-only)
  const stranded = Keypair.generate();
  await fund(stranded.publicKey);
  await setUsdc(stranded.publicKey, 7_000_000n);
  await send("finish into vault (steps-only recovery)", stepsToIxs(finishIntoVaultSteps(v, stranded.publicKey, 6_960_000n), { "{INTERMEDIARY}": stranded.publicKey.toBase58() }), [stranded]);
  assert((await balance(ata(stranded.publicKey, v.shareMint))) > 6_800_000n, "stranded funds landed");

  const health = await strategyHealth(conn);
  console.log(`  Kamino reserve active ${health.kamino.active}, emergency ${health.kamino.emergencyMode}, headroom ${fmt(health.kamino.headroom)} · Jupiter Lend price ${Number(health.jupiterLend.exchangePrice) / 1e12}`);
  const end = await readNav(conn, v);
  console.log(`  final NAV ${fmt(end.total)} · landed ${end.vault.landedCount} deposits · redeemed ${fmt(end.vault.redeemedTotal)}`);
  console.log("fork e2e: all good");
  if (process.env.OUT) (await import("node:fs")).writeFileSync(process.env.OUT, JSON.stringify({ ranAt: new Date().toISOString(), rpc: "surfpool mainnet fork", results }, null, 2) + "\n");
};

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
