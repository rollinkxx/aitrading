import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { indodaxTarget } from "./policy.ts";
import { readBoundedBody } from "./body-limit.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const MAX_RESPONSE_BYTES = 2_000_000;
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: cors });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "GET") return json({ error: "method not allowed" }, 405);

  const target = indodaxTarget(new URL(req.url));
  if (!target) return json({ error: "unsupported market-data request" }, 404);

  try {
    const upstream = await fetch(target, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; AITrading/1.1; public-market-data)",
        Referer: "https://indodax.com/",
      },
      signal: AbortSignal.timeout(10_000),
    });
    const contentType = upstream.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("json")) {
      console.error(JSON.stringify({ event: "indodax_proxy_non_json", status: upstream.status }));
      return json({ error: "market-data provider returned an invalid response" }, 502);
    }

    const declaredLength = Number(upstream.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
      return json({ error: "market-data response exceeded the allowed size" }, 502);
    }
    let body: string;
    try {
      body = await readBoundedBody(upstream.body, MAX_RESPONSE_BYTES);
    } catch (error) {
      if (error instanceof RangeError) {
        return json({ error: "market-data response exceeded the allowed size" }, 502);
      }
      throw error;
    }
    try { JSON.parse(body); }
    catch {
      console.error(JSON.stringify({ event: "indodax_proxy_invalid_json", status: upstream.status }));
      return json({ error: "market-data provider returned an invalid response" }, 502);
    }

    return new Response(body, {
      status: upstream.status,
      headers: {
        ...cors,
        "Content-Type": contentType,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "indodax_proxy_upstream_failed", error: String(error).slice(0, 200) }));
    return json({ error: "market-data provider temporarily unavailable" }, 502);
  }
});
