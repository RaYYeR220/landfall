import { addressBook, inboxExists } from "@/lib/server/addresses";
import { clientIp, limiter, verifyOwnership, type OwnershipProof } from "@/lib/server/auth";
import { bad, handle, json, pubkeyParam } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const perIp = limiter(5, 3_600_000);

/**
 * Persistent deposit addresses on every chain, all landing in the owner's
 * inbox. Opening a new inbox costs the keeper rent, so it needs a signed
 * ownership proof from the wallet; existing inboxes need none.
 */
export const POST = handle(async (req) => {
  const body = (await req.json().catch(() => ({}))) as { owner?: string; confidential?: boolean; proof?: OwnershipProof };
  const owner = pubkeyParam(body.owner ?? null);
  if (!owner) return bad("owner must be a Solana address");
  let allowCreate = false;
  if (!(await inboxExists(owner))) {
    if (!body.proof) return bad("sign in with your wallet to open your deposit addresses", 401);
    if (!perIp(clientIp(req))) return bad("too many requests", 429);
    const verified = await verifyOwnership(body.proof);
    if (!verified.equals(owner)) return bad("proof is for a different owner", 403);
    allowCreate = true;
  }
  return json(await addressBook(owner, { confidential: Boolean(body.confidential), allowCreate }));
});
