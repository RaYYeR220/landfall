/**
 * Curator and admin controls for a deployed vault.
 *
 *   KEYPAIR=… RPC=… npx tsx packages/sdk/scripts/curator.ts show
 *   … curator.ts weights <kamino %> <jupiter-lend %> [cap USDC]
 *   … curator.ts params <idle buffer %> <sweep fee USDC> <min sweep USDC>
 *   … curator.ts pause | resume
 *   … curator.ts strategy <kamino|jupiter-lend> <on|off>      (admin)
 */
import { readFileSync } from "node:fs";
import { Connection, Keypair, TransactionInstruction } from "@solana/web3.js";
import { readNav, sendReliably, setParamsIx, setPausedIx, setStrategyEnabledIx, setWeightsIx, strategyHealth, vaultAddresses } from "../src/index";

const conn = new Connection(process.env.RPC ?? "https://api.mainnet-beta.solana.com", "confirmed");
const v = vaultAddresses();
const signer = () => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.KEYPAIR ?? process.env.ADMIN_KEYPAIR ?? "", "utf8"))));
const usdc = (x: string) => BigInt(Math.round(Number(x) * 1e6));
const bps = (x: string) => Math.round(Number(x) * 100);
const fmt = (x: bigint) => (Number(x) / 1e6).toFixed(6);

const send = async (label: string, ix: TransactionInstruction) => {
  const sig = await sendReliably(conn, [ix], [signer()], { computeUnits: 50_000, priorityFee: 100_000 });
  console.log(`✓ ${label}  https://solscan.io/tx/${sig}`);
};

const show = async () => {
  const [nav, health] = await Promise.all([readNav(conn, v), strategyHealth(conn)]);
  const s = nav.vault;
  console.log(`vault ${v.vault.toBase58()}  curator ${s.curator.toBase58()}  paused ${s.paused}`);
  console.log(`NAV ${fmt(nav.total)} USDC · idle ${fmt(nav.idle)} · kamino ${fmt(nav.kamino)} · jupiter lend ${fmt(nav.jupiterLend)} · price ${fmt(nav.sharePrice1e6)}`);
  console.log(`weights kamino ${s.kamino.weightBps / 100}% (cap ${fmt(s.kamino.cap)}, ${s.kamino.enabled ? "on" : "off"}) · jupiter lend ${s.jlend.weightBps / 100}% (cap ${fmt(s.jlend.cap)}, ${s.jlend.enabled ? "on" : "off"}) · idle buffer ${s.idleBufferBps / 100}%`);
  console.log(`sweep fee ${fmt(s.sweepFee)} · min sweep ${fmt(s.minSweep)} · landed ${fmt(s.landedTotal)} in ${s.landedCount} · redeemed ${fmt(s.redeemedTotal)}`);
  console.log(`kamino reserve: active ${health.kamino.active}, emergency ${health.kamino.emergencyMode}, headroom ${fmt(health.kamino.headroom)} · jupiter lend readable ${health.jupiterLend.readable}`);
};

const main = async () => {
  const [cmd, a, b, c] = process.argv.slice(2);
  const who = () => signer().publicKey;
  switch (cmd) {
    case "show":
    case undefined:
      return show();
    case "weights": {
      const nav = await readNav(conn, v);
      const capK = c ? usdc(c) : nav.vault.kamino.cap;
      const capJ = c ? usdc(c) : nav.vault.jlend.cap;
      return send(`weights ${a}/${b}`, setWeightsIx(v, who(), bps(a), bps(b), capK, capJ));
    }
    case "params":
      return send(`params buffer ${a}% fee ${b} min ${c}`, setParamsIx(v, who(), bps(a), usdc(b), usdc(c)));
    case "pause":
    case "resume":
      return send(cmd, setPausedIx(v, who(), cmd === "pause"));
    case "strategy":
      if (a !== "kamino" && a !== "jupiter-lend") throw new Error("strategy is kamino or jupiter-lend");
      return send(`${a} ${b}`, setStrategyEnabledIx(v, who(), a, b === "on"));
    default:
      throw new Error(`unknown command ${cmd}`);
  }
};
main().catch((e) => {
  console.error(e.message ?? e);
  process.exitCode = 1;
});
