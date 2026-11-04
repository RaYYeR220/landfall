import { AURORA } from "@landfall/sdk";
import { auroraKey } from "@/lib/server/env";
import { bad, handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/**
 * Key-adding proxy for the Intents Connect SDK runner (`apiKeyProxyUrl`).
 * Only the execution create calls are forwarded; the browser calls every
 * other Intents Connect endpoint on the public API directly.
 */
const ALLOWED = /^api\/v1\/executions\/[^/]+(\/steps)?$/;

export const POST = handle(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api\/intents-connect\//, "");
  if (!ALLOWED.test(path)) return bad("not proxied", 404);
  const res = await fetch(`${AURORA.connectApi}/${path}${url.search}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": auroraKey() },
    body: await req.text(),
  });
  return new Response(await res.text(), { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
});
