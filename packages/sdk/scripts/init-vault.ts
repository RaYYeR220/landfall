/**
 * Initialise the mainnet vault (idempotent): create it, point it at Kamino and
 * Jupiter Lend, set curator weights and caps.
 *
 *   ADMIN_KEYPAIR=… RPC=… npx tsx packages/sdk/scripts/init-vault.ts
 */
import { readFileSync } from "node:fs";
import { ComputeBudgetProgram, Connection, Keypair, sendAndConfirmTransaction, Transaction, TransactionInstruction } from "@solana/web3.js";
import { configureJlendIx, configureKaminoIx, initVaultIx, readNav, setParamsIx, setWeightsIx, vaultAddresses } from "../src/index.js";

const rpc = process.env.RPC ?? "https://api.mainnet-beta.solana.com";
const conn = new Connection(rpc, "confirmed");
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.ADMIN_KEYPAIR!, "utf8"))));
const v = vaultAddresses();
const CAP = BigInt(process.env.STRATEGY_CAP_USDC ?? "5000") * 1_000_000n;

const send = async (label: string, ixs: TransactionInstruction[]) => {
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }), ...ixs);
  const sig = await sendAndConfirmTransaction(conn, tx, [admin], { commitment: "confirmed", maxRetries: 5 });
  console.log(`✓ ${label}  https://solscan.io/tx/${sig}`);
};

const main = async () => {
  console.log(`vault ${v.vault.toBase58()}  share mint ${v.shareMint.toBase58()}  admin ${admin.publicKey.toBase58()}`);
  if (!(await conn.getAccountInfo(v.vault))) {
    await send("init_vault (seed 1 USDC)", [
      initVaultIx(v, admin.publicKey, { curator: admin.publicKey, idleBufferBps: 1000, sweepFee: 10_000n, minSweep: 1_000_000n, seedAmount: 1_000_000n }),
    ]);
  } else console.log("vault exists");
  await send("configure_kamino + configure_jlend", [configureKaminoIx(v, admin.publicKey, true), configureJlendIx(v, admin.publicKey, true)]);
  await send("set_weights 60/40 + params", [setWeightsIx(v, admin.publicKey, 6000, 4000, CAP, CAP), setParamsIx(v, admin.publicKey, 1000, 10_000n, 1_000_000n)]);
  const nav = await readNav(conn, v);
  console.log(`NAV ${nav.total} (idle ${nav.idle}) · shares ${nav.shareSupply} · kamino ${nav.vault.kamino.enabled} · jlend ${nav.vault.jlend.enabled}`);
};
main().catch((e) => { console.error(e); process.exit(1); });
