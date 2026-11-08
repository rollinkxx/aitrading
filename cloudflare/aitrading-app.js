export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    if (!env.ASSETS) {
      console.error(JSON.stringify({ event: "assets_binding_missing", path: url.pathname }));
      return new Response("Static assets are temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
    }

    let assetResponse;
    try {
      assetResponse = await env.ASSETS.fetch(request);
    } catch (error) {
      console.error(JSON.stringify({ event: "assets_fetch_failed", path: url.pathname, error: String(error).slice(0, 200) }));
      return new Response("Static assets are temporarily unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
    }

    const headers = new Headers(assetResponse.headers);
    const isHtml = (headers.get("content-type") || "").toLowerCase().includes("text/html");
    const isManifest = url.pathname === "/manus-routes.json";
    const isHashedAsset = /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(url.pathname);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    if (assetResponse.status >= 400) headers.set("Cache-Control", "no-store");
    else if (isHtml || isManifest) headers.set("Cache-Control", "no-cache, max-age=0, must-revalidate");
    else if (isHashedAsset) headers.set("Cache-Control", "public, max-age=31536000, immutable");
    else headers.set("Cache-Control", "public, max-age=300");

    return new Response(assetResponse.body, {
      status: assetResponse.status,
      statusText: assetResponse.statusText,
      headers,
    });
  },
};
