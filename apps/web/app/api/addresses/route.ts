import { addressBook } from "@/lib/server/addresses";
import { bad, handle, json, pubkeyParam } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Persistent deposit addresses on every chain, all landing in the owner's inbox. */
export const POST = handle(async (req) => {
  const body = (await req.json().catch(() => ({}))) as { owner?: string; confidential?: boolean };
  const owner = pubkeyParam(body.owner ?? null);
  if (!owner) return bad("owner must be a Solana address");
  return json(await addressBook(owner, Boolean(body.confidential)));
});
