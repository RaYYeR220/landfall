import { PublicKey } from "@solana/web3.js";
import { inboxAddresses } from "@landfall/sdk";
import { connectApi, vault } from "@/lib/server/env";
import { bad, handle, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * Resolves the Solana identity that owns a wallet's vault shares. A Solana
 * wallet owns them itself; any other wallet owns them through its Intents
 * Connect Solana intermediary, which only that wallet's signature controls.
 */
export const GET = handle(async (req) => {
  const wallet = new URL(req.url).searchParams.get("wallet");
  if (!wallet) return bad("wallet is required");
  const inter = await connectApi().getIntermediary(wallet);
  const originType = (inter as { originType?: string }).originType ?? "unknown";
  if (!inter.solana) return bad("Solana intermediary unavailable for this wallet", 502);
  const intermediary = new PublicKey(inter.solana);
  const owner = originType === "solana" ? new PublicKey(wallet) : intermediary;
  const ib = inboxAddresses(vault, owner);
  return json({
    wallet,
    originType,
    owner: owner.toBase58(),
    intermediary: intermediary.toBase58(),
    ownsDirectly: originType === "solana",
    inbox: ib.inbox.toBase58(),
    inboxUsdc: ib.inboxUsdc.toBase58(),
    shares: ib.ownerShares.toBase58(),
  });
});
