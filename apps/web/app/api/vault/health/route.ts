import { PublicKey } from "@solana/web3.js";
import { ata, listInboxes, strategyHealth } from "@landfall/sdk";
import { connection, vault } from "@/lib/server/env";
import { handle, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

let cache: { at: number; body: unknown } | undefined;

const keeperKey = () => {
  const k = process.env.KEEPER_PUBLIC_KEY;
  try {
    return k ? new PublicKey(k) : null;
  } catch {
    return null;
  }
};

/** Live strategy conditions, the inbox queue and the keeper, for the vault page. */
export const GET = handle(async () => {
  if (cache && Date.now() - cache.at < 15_000) return json(cache.body);
  const conn = connection();
  const [health, inboxes] = await Promise.all([strategyHealth(conn), listInboxes(conn, vault).catch(() => null)]);

  let queue: { inboxes: number; waiting: number; waitingUsdc: number } | null = null;
  if (inboxes) {
    const accounts = inboxes.map((i) => ata(i.address, vault.usdcMint));
    let waiting = 0;
    let waitingUsdc = 0n;
    for (let i = 0; i < accounts.length; i += 100) {
      const infos = await conn.getMultipleAccountsInfo(accounts.slice(i, i + 100), "confirmed");
      for (const info of infos) {
        const amount = info && info.data.length >= 72 ? Buffer.from(info.data).readBigUInt64LE(64) : 0n;
        if (amount > 0n) {
          waiting++;
          waitingUsdc += amount;
        }
      }
    }
    queue = { inboxes: inboxes.length, waiting, waitingUsdc: Number(waitingUsdc) / 1e6 };
  }

  let keeper: { address: string; sol: number; lastActivity: number | null } | null = null;
  const kk = keeperKey();
  if (kk) {
    const [lamports, sigs] = await Promise.all([conn.getBalance(kk, "confirmed"), conn.getSignaturesForAddress(kk, { limit: 1 }, "confirmed").catch(() => [])]);
    keeper = { address: kk.toBase58(), sol: lamports / 1e9, lastActivity: sigs[0]?.blockTime ?? null };
  }

  const body = {
    at: Date.now(),
    kamino: {
      ...health.kamino,
      totalLiquidity: Number(health.kamino.totalLiquidity) / 1e6,
      depositLimit: Number(health.kamino.depositLimit) / 1e6,
      headroom: Number(health.kamino.headroom) / 1e6,
    },
    jupiterLend: { readable: health.jupiterLend.readable, exchangePrice: Number(health.jupiterLend.exchangePrice) / 1e12 },
    queue,
    keeper,
  };
  cache = { at: Date.now(), body };
  return json(body);
});
