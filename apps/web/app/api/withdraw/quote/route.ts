import { AURORA_ASSETS, WITHDRAW_DESTINATIONS } from "@landfall/sdk";
import { clientIp, limiter } from "@/lib/server/auth";
import { intents } from "@/lib/server/env";
import { bad, handle, json, pubkeyParam } from "@/lib/server/http";

export const dynamic = "force-dynamic";

const perIp = limiter(30, 3_600_000);

const RECIPIENT: Record<string, RegExp> = {
  evm: /^0x[0-9a-fA-F]{40}$/,
  "tron-usdt": /^T[1-9A-HJ-NP-Za-km-z]{33}$/,
  btc: /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/,
};

/**
 * Swap API quote for a Solana wallet withdrawing to another chain. The wallet
 * then redeems and pays the returned deposit address in one transaction.
 * Refunds go back to the same wallet on Solana.
 */
export const POST = handle(async (req) => {
  if (!perIp(clientIp(req))) return bad("too many requests", 429);
  const body = (await req.json().catch(() => ({}))) as { owner?: string; destination?: string; recipient?: string; amount?: string };
  const owner = pubkeyParam(body.owner ?? null);
  if (!owner) return bad("owner must be a Solana address");
  const dest = WITHDRAW_DESTINATIONS.find((d) => d.id === body.destination);
  if (!dest) return bad("unknown destination");
  const recipient = (body.recipient ?? "").trim();
  if (!(RECIPIENT[dest.evm ? "evm" : dest.id] ?? /.+/).test(recipient)) return bad(`not a valid ${dest.label} address`);
  if (!/^\d+$/.test(body.amount ?? "") || BigInt(body.amount!) < 1_000_000n) return bad("withdraw at least 1 USDC");
  const res = await intents().quote({
    dry: false,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: AURORA_ASSETS.solanaUsdc,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: dest.assetId,
    amount: body.amount!,
    refundTo: owner.toBase58(),
    refundType: "ORIGIN_CHAIN",
    recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(Date.now() + 30 * 60_000).toISOString(),
  });
  const q = res.quote;
  if (!q.depositAddress) return bad("no deposit address in the quote", 502);
  return json({
    depositAddress: q.depositAddress,
    amountIn: q.amountIn,
    amountOut: q.amountOut,
    amountOutFormatted: q.amountOutFormatted,
    minAmountOut: q.minAmountOut,
    timeEstimate: Number(q.timeEstimate ?? 0),
    deadline: q.deadline,
    destination: dest,
  });
});
