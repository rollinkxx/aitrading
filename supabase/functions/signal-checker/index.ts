import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { evaluateOutcome, freshPrice, fullCollectorOwnsThisMinute, type Signal, type SummaryTicker } from "./core.ts";
import { persistSignalOutcomes } from "../_shared/signal-outcomes.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-collector-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: cors });
const baseUrl = Deno.env.get("SUPABASE_URL")!;
let serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
if (!serviceRole) {
  try { serviceRole = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default || ""; } catch { /* use empty and fail closed */ }
}
if (!baseUrl || !serviceRole) throw new Error("Supabase service credentials are unavailable");

async function db(path: string, init: RequestInit = {}) {
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`database ${response.status}: ${text.slice(0, 250)}`);
  return text ? JSON.parse(text) : null;
}

async function authenticate(req: Request) {
  const provided = req.headers.get("x-collector-secret") || "";
  if (!provided) return false;
  return await db("rpc/verify_collector_secret", {
    method: "POST",
    body: JSON.stringify({ provided_secret: provided }),
  }) === true;
}

async function officialSummaries() {
  const response = await fetch("https://indodax.com/api/summaries", {
    headers: { Accept: "application/json", "User-Agent": "AITrading/1.1 (+official-public-market-data)", Referer: "https://indodax.com/" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Indodax summaries returned ${response.status}`);
  const payload = await response.json();
  if (!payload?.tickers || typeof payload.tickers !== "object") throw new Error("Indodax summaries payload is invalid");
  return payload.tickers as Record<string, SummaryTicker>;
}

function normalizePair(key: string) { return key.toLowerCase().replace(/_/g, ""); }

async function checkActiveSignals() {
  const now = Date.now();
  if (fullCollectorOwnsThisMinute(now)) {
    const result = { ok: true, skipped: "full collector owns this five-minute boundary", delegatedToCollector: true };
    console.log(JSON.stringify({ event: "signal_check_skipped", ...result }));
    return result;
  }
  const nowIso = new Date(now).toISOString();
  const expiresFilter = encodeURIComponent(nowIso);

  await db(`signals?status=eq.active&expires_at=lt.${expiresFilter}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "expired" }),
    headers: { Prefer: "return=minimal" },
  });

  const active = await db(
    `signals?select=id,market_id,signal_type,reference_price,stop_loss,take_profit&status=eq.active&signal_type=in.(BUY,SELL)&expires_at=gt.${expiresFilter}&limit=500`,
  ) as Signal[];
  if (!active.length) {
    console.log(JSON.stringify({ event: "signal_check_completed", active: 0, checked: 0, expirySweep: "performed", outcomes: 0 }));
    return { ok: true, active: 0, checked: 0, staleOrMissing: 0, expirySweep: "performed", outcomes: 0, skipped: "no active signals" };
  }

  const rawTickers = await officialSummaries();
  const tickers = new Map<string, SummaryTicker>();
  for (const [key, value] of Object.entries(rawTickers)) tickers.set(normalizePair(key), value);

  const outcomeRows: { signal_id: string; exit_price: number; return_percentage: number; outcome: string; closed_at: string; evaluation_method: "snapshot_sampled" }[] = [];
  let checked = 0;
  let staleOrMissing = 0;
  for (const signal of active) {
    const ticker = tickers.get(normalizePair(signal.market_id));
    if (freshPrice(ticker, now) === null) { staleOrMissing++; continue; }
    checked++;
    const outcome = evaluateOutcome(signal, ticker, now);
    if (!outcome) continue;
    outcomeRows.push({
      signal_id: outcome.signalId,
      exit_price: outcome.exitPrice,
      return_percentage: outcome.returnPercentage,
      outcome: outcome.outcome,
      closed_at: nowIso,
      evaluation_method: "snapshot_sampled",
    });
  }

  const persistedOutcomes = await persistSignalOutcomes(
    outcomeRows,
    rows => db("signal_outcomes?on_conflict=signal_id", {
      method: "POST",
      body: JSON.stringify(rows),
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
    }),
    ids => db(`signals?id=in.(${ids.map(encodeURIComponent).join(",")})&status=eq.active`, {
      method: "PATCH",
      body: JSON.stringify({ status: "closed" }),
      headers: { Prefer: "return=minimal" },
    }),
  );

  const result = { ok: true, active: active.length, checked, staleOrMissing, expirySweep: "performed", outcomes: persistedOutcomes };
  console.log(JSON.stringify({ event: "signal_check_completed", ...result }));
  return result;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    if (!(await authenticate(req))) return json({ error: "unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    if (body.mode !== "check_active") return json({ error: "unsupported mode" }, 400);
    return json(await checkActiveSignals());
  } catch (error) {
    console.error(JSON.stringify({ event: "signal_check_failed", error: String(error).slice(0, 300) }));
    return json({ error: "signal check failed", detail: String(error).slice(0, 250) }, 500);
  }
});
