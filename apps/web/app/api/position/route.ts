import { chainHistory, position } from "@/lib/server/position";
import { bad, handle, json, pubkeyParam } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export const GET = handle(async (req) => {
  const params = new URL(req.url).searchParams;
  const owner = pubkeyParam(params.get("owner"));
  if (!owner) return bad("owner must be a Solana address");
  const [p, history] = await Promise.all([position(owner), params.get("history") ? chainHistory(owner) : Promise.resolve([])]);
  return json({ ...p, history });
});
