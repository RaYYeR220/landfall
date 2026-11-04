import { vaultSummary } from "@/lib/server/position";
import { handle, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const GET = handle(async () => json(await vaultSummary(), { headers: { "cache-control": "s-maxage=10, stale-while-revalidate=30" } }));
