/**
 * Landfall keeper: sweeps every inbox a persistent deposit address has paid,
 * moves spare idle USDC toward the curator's weights, and refreshes the cached
 * strategy values. Every instruction it sends is permissionless.
 *
 *   KEEPER_SECRET_KEY=… SOLANA_RPC_URL=… pnpm --filter @landfall/keeper start
 */
import { Connection, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { crankOnce, vaultAddresses } from "@landfall/sdk";

const secret = process.env.KEEPER_SECRET_KEY;
if (!secret) throw new Error("KEEPER_SECRET_KEY is required");
const keeper = Keypair.fromSecretKey(secret.trim().startsWith("[") ? Uint8Array.from(JSON.parse(secret)) : bs58.decode(secret.trim()));
const connection = new Connection(process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com", "confirmed");
const vault = vaultAddresses();

const TICK_MS = Number(process.env.KEEPER_TICK_MS ?? 15_000);
const SYNC_EVERY = Number(process.env.KEEPER_SYNC_EVERY ?? 40); // ticks (~10 min)
let backoff = 0;

const log = (msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

const loop = async () => {
  log("keeper up", { keeper: keeper.publicKey.toBase58(), vault: vault.vault.toBase58(), tickMs: TICK_MS });
  for (let tick = 0; ; tick++) {
    try {
      const actions = await crankOnce({ connection, keeper, vault, priorityFee: 20_000, sync: tick % SYNC_EVERY === 0 });
      for (const a of actions) log(a.kind, a);
      backoff = 0;
    } catch (e) {
      backoff = Math.min(backoff ? backoff * 2 : TICK_MS, 5 * 60_000);
      log("tick failed", { error: (e as Error).message, retryInMs: backoff });
    }
    await new Promise((r) => setTimeout(r, backoff || TICK_MS));
  }
};

loop();
