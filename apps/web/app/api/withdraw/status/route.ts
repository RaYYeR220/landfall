import { intents } from "@/lib/server/env";
import { bad, handle, json, pubkeyParam } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const address = new URL(req.url).searchParams.get("depositAddress");
  if (!pubkeyParam(address)) return bad("depositAddress must be a Solana address");
  const s = await intents().swapStatus(address!);
  return json({ status: s.status, details: (s as { swapDetails?: unknown }).swapDetails ?? null });
});
