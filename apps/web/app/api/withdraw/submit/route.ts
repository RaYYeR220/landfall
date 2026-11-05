import { intents } from "@/lib/server/env";
import { bad, handle, json, pubkeyParam } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Reports the Solana payment to the quote's deposit address so the swap starts right away. */
export const POST = handle(async (req) => {
  const body = (await req.json().catch(() => ({}))) as { txHash?: string; depositAddress?: string };
  if (!pubkeyParam(body.depositAddress ?? null)) return bad("depositAddress must be a Solana address");
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(body.txHash ?? "")) return bad("txHash must be a Solana signature");
  return json(await intents().submitDeposit(body.txHash!, body.depositAddress!));
});
