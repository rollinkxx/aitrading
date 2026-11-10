import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { evaluateOutcome, freshPrice, fullCollectorOwnsThisMinute, type Signal, type SummaryTicker } from "./core.ts";
import { persistSignalOutcomes } from "../_shared/signal-outcomes.ts";
import { fetchKeysetPages } from "../_shared/pagination.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-collector-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: cors });
const CHECKER_DEADLINE_MS = 40_000;
const DB_REQUEST_TIMEOUT_MS = 5_000;
const SIGNAL_PAGE_SIZE = 100;
const SIGNAL_MAX_ROWS = 1_000;
const baseUrl = Deno.env.get("SUPABASE_URL")!;
let serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
if (!serviceRole) {
  try { serviceRole = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default || ""; } catch { /* use empty and fail closed */ }
}
if (!baseUrl || !serviceRole) throw new Error("Supabase service credentials are unavailable");

async function db(path: string, init: RequestInit = {}, deadlineAt = Date.now() + DB_REQUEST_TIMEOUT_MS) {
  const remaining = Math.min(DB_REQUEST_TIMEOUT_MS, deadlineAt - Date.now());
  if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("database deadline exceeded");
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(Math.max(100, Math.floor(remaining))),
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

async function authenticate(req: Request, deadlineAt: number) {
  const provided = req.headers.get("x-collector-secret") || "";
  if (!provided) return false;
  return await db("rpc/verify_collector_secret", {
    method: "POST",
    body: JSON.stringify({ provided_secret: provided }),
  }, deadlineAt) === true;
}

async function readScanCursor(override: string | null, deadlineAt: number) {
  if (override) return override;
  const rows = await db("signal_checker_state?select=cursor_id&singleton_id=eq.1&limit=1", {}, deadlineAt) as { cursor_id: string | null }[];
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error("signal checker cursor state is missing");
  return typeof rows[0].cursor_id === "string" ? rows[0].cursor_id : null;
}

async function persistScanCursor(cursorId: string | null, deadlineAt: number) {
  const rows = await db("signal_checker_state?singleton_id=eq.1", {
    method: "PATCH",
    body: JSON.stringify({ cursor_id: cursorId, updated_at: new Date().toISOString() }),
    headers: { Prefer: "return=representation" },
  }, deadlineAt) as { singleton_id: number }[];
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error("signal checker cursor checkpoint was not saved");
}

async function officialSummaries(deadlineAt: number) {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw new Error("checker deadline exceeded before market request");
  const response = await fetch("https://indodax.com/api/summaries", {
    headers: { Accept: "application/json", "User-Agent": "AITrading/1.1 (+official-public-market-data)", Referer: "https://indodax.com/" },
    signal: AbortSignal.timeout(Math.max(100, Math.min(10_000, remaining))),
  });
  if (!response.ok) throw new Error(`Indodax summaries returned ${response.status}`);
  const payload = await response.json();
  if (!payload?.tickers || typeof payload.tickers !== "object") throw new Error("Indodax summaries payload is invalid");
  return payload.tickers as Record<string, SummaryTicker>;
}

function normalizePair(key: string) { return key.toLowerCase().replace(/_/g, ""); }

async function checkActiveSignals(afterId: string | null, deadlineAt: number) {
  const now = Date.now();
  if (fullCollectorOwnsThisMinute(now)) {
    const result = { ok: true, skipped: "full collector owns this five-minute boundary", delegatedToCollector: true };
    console.log(JSON.stringify({ event: "signal_check_skipped", ...result }));
    return result;
  }
  const nowIso = new Date(now).toISOString();
  const expiresFilter = encodeURIComponent(nowIso);

  const expiredSignals = Number(await db("rpc/expire_active_signals_batch", {
    method: "POST",
    body: JSON.stringify({ p_batch_size: 1000 }),
  }, deadlineAt)) || 0;
  const scanCursor = await readScanCursor(afterId, deadlineAt);

  const page = await fetchKeysetPages<Signal>((cursor, limit) => {
    const cursorFilter = cursor ? `&id=gt.${encodeURIComponent(cursor)}` : "";
    return db(`signals?select=id,market_id,signal_type,reference_price,stop_loss,take_profit,expires_at&status=eq.active&signal_type=in.(BUY,SELL)&expires_at=gt.${expiresFilter}${cursorFilter}&order=id.asc&limit=${limit}`, {}, deadlineAt);
  }, { pageSize: SIGNAL_PAGE_SIZE, maxRows: SIGNAL_MAX_ROWS, deadlineAt, afterId: scanCursor });
  const active = page.rows;
  if (!active.length) {
    const nextCursor = page.hasMore ? page.nextCursor : null;
    await persistScanCursor(nextCursor, deadlineAt);
    const result = { ok: true, active: 0, checked: 0, staleOrMissing: 0, expirySweep: "performed", expiredSignals, expiryBacklog: expiredSignals >= 1000, outcomes: 0, backlog: page.hasMore, truncated: page.truncated, hasMore: page.hasMore, nextCursor };
    console.log(JSON.stringify({ event: "signal_check_completed", ...result }));
    return { ...result, skipped: page.hasMore ? "no signals after cursor; continue keyset scan" : "no active signals" };
  }

  const rawTickers = await officialSummaries(deadlineAt);
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
    }, deadlineAt),
    ids => db(`signals?id=in.(${ids.map(encodeURIComponent).join(",")})&status=eq.active`, {
      method: "PATCH",
      body: JSON.stringify({ status: "closed" }),
      headers: { Prefer: "return=minimal" },
    }, deadlineAt),
  );

  const nextCursor = page.hasMore ? page.nextCursor : null;
  await persistScanCursor(nextCursor, deadlineAt);
  const result = { ok: true, active: active.length, checked, staleOrMissing, expirySweep: "performed", expiredSignals, expiryBacklog: expiredSignals >= 1000, outcomes: persistedOutcomes, backlog: page.hasMore, truncated: page.truncated, hasMore: page.hasMore, nextCursor, scanOrder: "id.asc", scanContinuation: "persisted in signal_checker_state; resumes on the next cron invocation" };
  console.log(JSON.stringify({ event: "signal_check_completed", ...result }));
  return result;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const deadlineAt = Date.now() + CHECKER_DEADLINE_MS;
  try {
    if (!(await authenticate(req, deadlineAt))) return json({ error: "unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    if (body.mode !== "check_active") return json({ error: "unsupported mode" }, 400);
    const afterId = typeof body.afterId === "string" && body.afterId.length ? body.afterId : null;
    return json(await checkActiveSignals(afterId, deadlineAt));
  } catch (error) {
    console.error(JSON.stringify({ event: "signal_check_failed", error: String(error).slice(0, 300) }));
    return json({ error: "signal check failed", detail: String(error).slice(0, 250) }, 500);
  }
});
