import { bad, handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Narrow RPC proxy so the browser never sees the RPC provider key. */
const METHODS = new Set([
  "getAccountInfo",
  "getMultipleAccounts",
  "getBalance",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getLatestBlockhash",
  "getSignatureStatuses",
  "getSignaturesForAddress",
  "getTransaction",
  "getSlot",
  "getMinimumBalanceForRentExemption",
  "getFeeForMessage",
  "sendTransaction",
  "simulateTransaction",
]);

export const POST = handle(async (req) => {
  const body = await req.text();
  const parsed = JSON.parse(body) as { method?: string } | { method?: string }[];
  const methods = (Array.isArray(parsed) ? parsed : [parsed]).map((p) => p.method ?? "");
  if (!methods.every((m) => METHODS.has(m))) return bad("method not allowed", 403);
  const res = await fetch(process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
});
