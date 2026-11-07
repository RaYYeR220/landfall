import { demoBudget, fireViaAddress, fireViaConnect } from "@/lib/server/demo";
import { clientIp, limiter } from "@/lib/server/auth";
import { bad, handle, json } from "@/lib/server/http";

const perIp = limiter(3, 3_600_000);

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Fires one real, spend-capped mainnet deposit from the demo wallet on Base. */
export const POST = handle(async (req) => {
  if (!perIp(clientIp(req))) return bad("you have fired a few already, give it an hour", 429);
  const { route } = (await req.json().catch(() => ({}))) as { route?: "address" | "connect" };
  return json(route === "connect" ? await fireViaConnect() : await fireViaAddress());
});

/** What a fire sends, for the page copy. No balances, no addresses. */
export const GET = handle(async () => json(demoBudget(), { headers: { "cache-control": "s-maxage=60" } }));
