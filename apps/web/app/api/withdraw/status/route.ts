import { clientIp, limiter } from "@/lib/server/auth";
import { intents } from "@/lib/server/env";
import { bad, handle, json, pubkeyParam } from "@/lib/server/http";
import { checkQuoteToken } from "@/lib/server/quoteToken";

export const dynamic = "force-dynamic";

const perIp = limiter(400, 3_600_000);

/** Status of a withdrawal swap this server quoted. */
export const GET = handle(async (req) => {
  if (!perIp(clientIp(req))) return bad("too many requests", 429);
  const q = new URL(req.url).searchParams;
  const address = q.get("depositAddress");
  if (!pubkeyParam(address)) return bad("depositAddress must be a Solana address");
  if (!checkQuoteToken(address!, q.get("token"))) return bad("unknown quote", 403);
  const s = await intents().swapStatus(address!);
  return json({ status: s.status });
});
