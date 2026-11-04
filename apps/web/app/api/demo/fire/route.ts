import { fireViaAddress, fireViaConnect } from "@/lib/server/demo";
import { handle, json } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Fires one real, spend-capped mainnet deposit from the demo wallet on Base. */
export const POST = handle(async (req) => {
  const { route } = (await req.json().catch(() => ({}))) as { route?: "address" | "connect" };
  return json(route === "connect" ? await fireViaConnect() : await fireViaAddress());
});
