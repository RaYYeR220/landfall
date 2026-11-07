/**
 * Initialise the mainnet vault (idempotent): create it, point it at Kamino and
 * Jupiter Lend, set curator weights and caps.
 *
 *   ADMIN_KEYPAIR=… RPC=… npx tsx packages/sdk/scripts/init-vault.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, TransactionInstruction } from "@solana/web3.js";
import { configureJlendIx, configureKaminoIx, initVaultIx, readNav, sendReliably, setParamsIx, setWeightsIx, vaultAddresses } from "../src/index";

const rpc = process.env.RPC ?? "https://api.mainnet-beta.solana.com";
const conn = new Connection(rpc, "confirmed");
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.ADMIN_KEYPAIR!, "utf8"))));
const v = vaultAddresses();
const CAP = BigInt(process.env.STRATEGY_CAP_USDC ?? "5000") * 1_000_000n;

const send = async (label: string, ixs: TransactionInstruction[]) => {
  const sig = await sendReliably(conn, ixs, [admin], { computeUnits: 300_000, priorityFee: 200_000, log: (m) => console.log(`  ${label}: ${m}`) });
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
  const out = fileURLToPath(new URL("../../../eval/results/deployment.json", import.meta.url));
  const deployment = {
    cluster: "mainnet-beta",
    programId: v.programId.toBase58(),
    vault: v.vault.toBase58(),
    shareMint: v.shareMint.toBase58(),
    admin: admin.publicKey.toBase58(),
    curator: nav.vault.curator.toBase58(),
    appUrl: process.env.APP_URL ?? null,
    repoUrl: process.env.REPO_URL ?? null,
    mirrorUrl: process.env.MIRROR_URL ?? null,
    videoUrl: process.env.VIDEO_URL ?? null,
    initialisedAt: new Date().toISOString(),
  };
  writeFileSync(out, JSON.stringify(deployment, null, 2) + "\n");
  console.log(`wrote ${out}`);
};
main().catch((e) => { console.error(e); process.exit(1); });
