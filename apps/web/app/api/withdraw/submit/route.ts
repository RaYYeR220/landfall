import { clientIp, limiter } from "@/lib/server/auth";
import { intents } from "@/lib/server/env";
import { bad, handle, json, pubkeyParam } from "@/lib/server/http";
import { checkQuoteToken } from "@/lib/server/quoteToken";

export const dynamic = "force-dynamic";

const perIp = limiter(30, 3_600_000);

/** Reports the Solana payment to a deposit address this server quoted, so the swap starts right away. */
export const POST = handle(async (req) => {
  if (!perIp(clientIp(req))) return bad("too many requests", 429);
  const body = (await req.json().catch(() => ({}))) as { txHash?: string; depositAddress?: string; token?: string };
  if (!pubkeyParam(body.depositAddress ?? null)) return bad("depositAddress must be a Solana address");
  if (!checkQuoteToken(body.depositAddress!, body.token)) return bad("unknown quote", 403);
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(body.txHash ?? "")) return bad("txHash must be a Solana signature");
  const r = await intents().submitDeposit(body.txHash!, body.depositAddress!);
  return json({ status: r.status });
});
