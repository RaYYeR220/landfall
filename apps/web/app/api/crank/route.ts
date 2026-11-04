import { crankOnce } from "@landfall/sdk";
import { connection, keeper, vault } from "@/lib/server/env";
import { bad, handle, json, pubkeyParam } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

let last = 0;

/** On-demand crank for one owner; the keeper service runs the same loop for every inbox. */
export const POST = handle(async (req) => {
  const body = (await req.json().catch(() => ({}))) as { owner?: string };
  const owner = pubkeyParam(body.owner ?? null);
  if (!owner) return bad("owner must be a Solana address");
  if (Date.now() - last < 5_000) return json({ actions: [], throttled: true });
  last = Date.now();
  const actions = await crankOnce({ connection: connection(), keeper: keeper(), vault, owners: [owner], priorityFee: 20_000 });
  return json({ actions: actions.map((a) => ("amount" in a ? { ...a, amount: a.amount.toString() } : a)) });
});
