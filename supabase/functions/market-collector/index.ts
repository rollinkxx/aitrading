import "jsr:@supabase/functions-js@2.119.0/edge-runtime.d.ts";
import { capRows, fetchAllPages } from "../_shared/pagination.ts";
import { normalizeDepth, validDepth, validTicker } from "../_shared/market-quality.ts";
import { buildSignal, type Signal } from "../_shared/strategy.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-collector-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: cors });
const RUN_WINDOW_MS = 5 * 60_000;
const MAX_SIGNAL_MARKETS = 8;
const SNAPSHOT_SIGNALS_LIMIT = 500;
const CANDLE_HISTORY = 220;
const CANDLE_RETENTION = 80;
// Leave headroom for persistence and the 30-second pg_net timeout.
const COLLECTOR_DEADLINE_MS = 25_000;

type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
type Depth = { buy: [number, number][]; sell: [number, number][] };
type Ticker = { last: number; buy: number; sell: number; high: number; low: number; volume: number; sourceTime: number };
import { closedCandles } from "../_shared/candle-history.ts";

const baseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}")?.default;
if (!baseUrl || !serviceRole) throw new Error("Supabase service credentials are unavailable");

async function db(path: string, init: RequestInit = {}, deadlineAt?: number) {
  const remaining = deadlineAt === undefined ? 12_000 : Math.min(12_000, deadlineAt - Date.now());
  if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("database deadline exceeded");
  const signal = init.signal ?? AbortSignal.timeout(Math.max(100, Math.floor(remaining)));
  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...init,
    signal,
    headers: {
      apikey: serviceRole,
      Authorization: `Bearer ${serviceRole}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`database ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function official(path: string, deadlineAt?: number) {
  const remaining = deadlineAt === undefined ? 15_000 : Math.min(15_000, deadlineAt - Date.now());
  if (!Number.isFinite(remaining) || remaining <= 0) throw new Error("collector deadline exceeded");
  const response = await fetch(`https://indodax.com${path}`, {
    headers: { Accept: "application/json", "User-Agent": "AITrading/1.1 (+official-public-market-data)", Referer: "https://indodax.com/" },
    signal: AbortSignal.timeout(Math.max(1_000, Math.floor(remaining))),
  });
  if (!response.ok) throw new Error(`Indodax ${path} returned ${response.status}`);
  return response.json();
}

function validNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function normalizePair(key: string) { return key.toLowerCase().replace(/_/g, ""); }
function ema(values: number[], period: number) {
  if (values.length < period) return values.at(-1) || 0;
  const k = 2 / (period + 1);
  let value = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (const point of values.slice(period)) value = point * k + value * (1 - k);
  return value;
}
function rsi(values: number[], period = 14) {
  if (values.length <= period) return 50;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) { const d = values[i] - values[i - 1]; gain += Math.max(d, 0); loss += Math.max(-d, 0); }
  let ag = gain / period, al = loss / period;
  for (let i = period + 1; i < values.length; i++) { const d = values[i] - values[i - 1]; ag = (ag * (period - 1) + Math.max(d, 0)) / period; al = (al * (period - 1) + Math.max(-d, 0)) / period; }
  if (ag === 0 && al === 0) return 50;
  if (al === 0) return 100;
  if (ag === 0) return 0;
  return 100 - 100 / (1 + ag / al);
}
function atr(candles: Candle[], period = 14) {
  if (candles.length < period + 1) return 0;
  const tr = candles.slice(1).map((x, i) => Math.max(x.high - x.low, Math.abs(x.high - candles[i].close), Math.abs(x.low - candles[i].close)));
  return tr.slice(-period).reduce((a, b) => a + b, 0) / period;
}
async function authenticate(req: Request, deadlineAt?: number) {
  const provided = req.headers.get("x-collector-secret") || "";
  if (!provided) return false;
  const result = await db("rpc/verify_collector_secret", { method: "POST", body: JSON.stringify({ provided_secret: provided }) }, deadlineAt);
  return result === true;
}
async function latestSnapshot() {
  const [markets, ticks, signals, runs] = await Promise.all([
    fetchAllPages((offset, limit) => db(`markets?select=id,symbol,base_asset,quote_asset,status,last_synced_at&order=symbol.asc&limit=${limit}&offset=${offset}`)),
    fetchAllPages((offset, limit) => db(`latest_market_ticks?select=market_id,last_price,best_bid,best_ask,volume_24h,high_24h,low_24h,source_timestamp,received_at,data_status&order=market_id.asc&limit=${limit}&offset=${offset}`)),
    db(`signals?select=id,market_id,signal_type,timeframe,confidence,reference_price,entry_low,entry_high,stop_loss,take_profit,risk_reward,reason_text,data_quality,created_at,expires_at,status&status=in.(active,informational)&order=created_at.desc,id.desc&limit=${SNAPSHOT_SIGNALS_LIMIT + 1}`),
    db("collector_runs?select=started_at,finished_at,status,markets_count,ticks_count,candles_count,signals_count,outcomes_count&order=started_at.desc&limit=1"),
  ]);
  const { rows: visibleSignals, hasMore } = capRows(signals, SNAPSHOT_SIGNALS_LIMIT);
  return {
    markets, ticks, signals: visibleSignals, signalsLimit: SNAPSHOT_SIGNALS_LIMIT,
    signalsTruncated: hasMore, hasMore,
    latestRun: runs?.[0] || null, servedAt: new Date().toISOString(),
  };
}

function isValidCandle(candle: Candle, now: number): boolean {
  const { time, open, high, low, close, volume } = candle;
  const pricesAreFinite = [open, high, low, close, volume].every(Number.isFinite);
  const pricesArePositive = open > 0 && high > 0 && low > 0 && close > 0;
  const rangeIsConsistent = low <= Math.min(open, close) && high >= Math.max(open, close);
  return Number.isFinite(time) && time > 0 && time <= now + 60_000
    && pricesAreFinite && pricesArePositive && volume >= 0 && rangeIsConsistent;
}

function toCandles(raw: unknown, now: number): Candle[] {
  const rows = Array.isArray(raw) ? raw : [];
  const candles: Candle[] = [];
  for (const value of rows) {
    if (!value || typeof value !== "object") continue;
    const item = value as Record<string, unknown>;
    const candle: Candle = {
      time: Number(item.Time) * 1000,
      open: Number(item.Open),
      high: Number(item.High),
      low: Number(item.Low),
      close: Number(item.Close),
      volume: Number(item.Volume ?? 0),
    };
    if (isValidCandle(candle, now)) candles.push(candle);
  }
  return candles.sort((left, right) => left.time - right.time).slice(-CANDLE_HISTORY);
}

async function collect(deadlineAt = Date.now() + COLLECTOR_DEADLINE_MS) {
  const now = Date.now();
  const runKey = String(Math.floor(now / RUN_WINDOW_MS));
  const deadlineDb = (path: string, init: RequestInit = {}) => db(path, init, deadlineAt);
  const claim = await deadlineDb("rpc/claim_collector_run", { method: "POST", body: JSON.stringify({ p_run_key: runKey, p_lease_seconds: 90 }) });
  const lease = Array.isArray(claim) ? claim[0] : claim;
  if (!lease?.claimed || !lease.run_id || !lease.fencing_token) return { skipped: true, reason: "this five-minute run window is already owned", runKey };
  const runFilter = `id=eq.${encodeURIComponent(lease.run_id)}&fencing_token=eq.${encodeURIComponent(lease.fencing_token)}&status=eq.running`;
  let marketsCount = 0, ticksCount = 0, candlesCount = 0, signalsCount = 0, outcomesCount = 0;
  try {
    const [pairsResponse, summariesResponse] = await Promise.all([official("/api/pairs", deadlineAt), official("/api/summaries", deadlineAt)]);
    const pairs = (Array.isArray(pairsResponse) ? pairsResponse : []).filter((p: any) => typeof p.id === "string" && p.id.toLowerCase().endsWith("idr"));
    const tickers = summariesResponse?.tickers || {};
    const byId = new Map<string, any>();
    for (const [key, ticker] of Object.entries(tickers)) byId.set(normalizePair(key), ticker);
    const marketRows = pairs.map((p: any) => ({
      id: p.id.toLowerCase(), symbol: String(p.symbol || p.id).toUpperCase(), base_asset: p.id.slice(0, -3).toUpperCase(), quote_asset: "IDR",
      status: p.is_maintenance || p.is_market_suspended ? "suspended" : "active", source: "indodax-official", last_synced_at: new Date(now).toISOString(),
    }));
    marketsCount = marketRows.length;
    const tickRows: any[] = [];
    for (const market of marketRows) {
      const t = byId.get(market.id);
      if (!t) continue;
      const last = validNumber(t.last), buy = validNumber(t.buy), sell = validNumber(t.sell), high = validNumber(t.high), low = validNumber(t.low), volume = validNumber(t.vol_idr ?? t.volume);
      if (last === null || buy === null || sell === null || high === null || low === null) continue;
      if (!validTicker({ last, buy, sell, high, low, volume: volume ?? 0 })) continue;
      const sourceMs = Number(t.server_time) > 0 ? Number(t.server_time) * 1000 : now;
      const age = now - sourceMs;
      if (age < -60_000 || age > 180_000) continue;
      tickRows.push({ market_id: market.id, last_price: last, best_bid: buy, best_ask: sell, volume_24h: volume, high_24h: high, low_24h: low, source_timestamp: new Date(sourceMs).toISOString(), data_status: age <= 120_000 ? "validated" : "stale" });
    }
    ticksCount = tickRows.length;
    const topMarkets = marketRows.filter((m: any) => {
      const raw = byId.get(m.id);
      const sourceMs = Number(raw?.server_time) * 1000;
      const age = now - sourceMs;
      return m.status === "active" && !!raw && sourceMs > 0 && age >= -60_000 && age <= 120_000;
    }).sort((a: any, b: any) => (Number(byId.get(b.id)?.vol_idr || 0) - Number(byId.get(a.id)?.vol_idr || 0))).slice(0, MAX_SIGNAL_MARKETS);
    const signalRows: any[] = [];
    const indicatorRows: any[] = [];
    const candleRows: any[] = [];
    for (const market of topMarkets) {
      const tickerRaw = byId.get(market.id);
      const ticker: Ticker = { last: Number(tickerRaw.last), buy: Number(tickerRaw.buy), sell: Number(tickerRaw.sell), high: Number(tickerRaw.high), low: Number(tickerRaw.low), volume: Number(tickerRaw.vol_idr || 0), sourceTime: Number(tickerRaw.server_time) * 1000 };
      const [depthRaw, raw15, raw60, raw240] = await Promise.all([
        official(`/api/depth/${market.id}`, deadlineAt),
        official(`/tradingview/history_v2?from=${Math.floor((now - 15 * 60_000 * CANDLE_HISTORY) / 1000)}&to=${Math.floor(now / 1000)}&symbol=${market.id}&tf=15`, deadlineAt),
        official(`/tradingview/history_v2?from=${Math.floor((now - 60 * 60_000 * CANDLE_HISTORY) / 1000)}&to=${Math.floor(now / 1000)}&symbol=${market.id}&tf=60`, deadlineAt),
        official(`/tradingview/history_v2?from=${Math.floor((now - 240 * 60_000 * CANDLE_HISTORY) / 1000)}&to=${Math.floor(now / 1000)}&symbol=${market.id}&tf=240`, deadlineAt),
      ]);
      const depth = normalizeDepth(depthRaw, 30);
      if (!depth || !validDepth(depth) || !validTicker(ticker)) continue;
      const c15 = toCandles(raw15, now), c60 = toCandles(raw60, now), c240 = toCandles(raw240, now);
      const closed15 = closedCandles(c15, "15", now), closed60 = closedCandles(c60, "60", now), closed240 = closedCandles(c240, "240", now);
      const result = buildSignal(closed15, closed60, closed240, ticker, depth);
      for (const [timeframe, bars] of [["15", c15], ["60", c60], ["240", c240]] as [string, Candle[]][]) {
        for (const candle of bars.slice(-CANDLE_RETENTION)) {
          const openTime = new Date(candle.time).toISOString();
          const interval = Number(timeframe) * 60_000;
          candleRows.push({ market_id: market.id, timeframe, open_time: openTime, close_time: new Date(candle.time + interval).toISOString(), open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume, is_closed: candle.time + interval <= now, source: "indodax-official" });
        }
        const closed = closedCandles(bars, timeframe, now);
        const closes = closed.map(x => x.close);
        const latest = closed[closed.length - 1];
        if (latest) indicatorRows.push({ market_id: market.id, timeframe, candle_time: new Date(latest.time).toISOString(), ema_20: ema(closes, 20), ema_50: ema(closes, 50), ema_200: ema(closes, 200), rsi: rsi(closes), macd: ema(closes, 12) - ema(closes, 26), macd_signal: ema(closes.map((_, i) => { const prefix = closes.slice(0, i + 1); return ema(prefix, 12) - ema(prefix, 26); }), 9), atr: atr(closed), volume_ratio: latest.volume / (closed.slice(-21, -1).reduce((s, x) => s + x.volume, 0) / Math.max(1, Math.min(20, closed.length - 1)) || 1) });
      }
      const bucket = Math.floor(now / (15 * 60_000));
      signalRows.push({ market_id: market.id, signal_type: result.type, timeframe: "15m/1h/4h", confidence: result.score, reference_price: ticker.last, entry_low: result.entryLow || null, entry_high: result.entryHigh || null, stop_loss: result.stopLoss || null, take_profit: result.takeProfit || null, risk_reward: result.riskReward || null, reason_codes: result.reasons.map((_, i) => `R${i + 1}`), reason_text: result.reasons.join(" "), data_quality: result.quality, expires_at: new Date(now + 15 * 60_000).toISOString(), status: result.type === "WAIT" || result.type === "HOLD" ? "informational" : "active", dedupe_key: `${market.id}:15m:${result.type}:${bucket}` });
    }
    if (!(await deadlineDb("rpc/heartbeat_collector_run", { method: "POST", body: JSON.stringify({ p_run_id: lease.run_id, p_fencing_token: lease.fencing_token, p_lease_seconds: 90 }) }))) {
      throw new Error("collector lease lost before persistence");
    }
    const currentPrices = Object.fromEntries(tickRows.filter((x: any) => {
      const sourceTime = Date.parse(x.source_timestamp);
      const age = now - sourceTime;
      return Number.isFinite(sourceTime) && age >= -60_000 && age <= 90_000;
    }).map((x: any) => [x.market_id, x.last_price]));
    const active = await deadlineDb(`signals?select=id,market_id,signal_type,reference_price,stop_loss,take_profit&status=eq.active&signal_type=in.(BUY,SELL)&expires_at=gt.${encodeURIComponent(new Date(now).toISOString())}&limit=500`);
    const outcomeRows: any[] = [];
    for (const s of active || []) {
      const price = currentPrices[s.market_id];
      if (!price || !s.stop_loss || !s.take_profit) continue;
      const stopHit = s.signal_type === "BUY" ? price <= Number(s.stop_loss) : price >= Number(s.stop_loss);
      const targetHit = s.signal_type === "BUY" ? price >= Number(s.take_profit) : price <= Number(s.take_profit);
      if (!stopHit && !targetHit) continue;
      const outcome = stopHit ? "stop_loss" : "take_profit";
      outcomeRows.push({ signal_id: s.id, exit_price: price, return_percentage: ((price - Number(s.reference_price || price)) / Number(s.reference_price || price)) * 100 * (s.signal_type === "SELL" ? -1 : 1), outcome, closed_at: new Date(now).toISOString(), evaluation_method: "snapshot_sampled" });
    }
    const persisted = await deadlineDb("rpc/persist_collector_batch", {
      method: "POST",
      body: JSON.stringify({
        p_run_id: lease.run_id,
        p_fencing_token: lease.fencing_token,
        p_markets: marketRows,
        p_ticks: tickRows,
        p_candles: candleRows,
        p_indicators: indicatorRows,
        p_signals: signalRows,
        p_outcomes: outcomeRows,
        p_expire_before: new Date(now).toISOString(),
      }),
    });
    const counts = Array.isArray(persisted) ? persisted[0] : persisted;
    marketsCount = Number(counts?.markets_count || 0);
    ticksCount = Number(counts?.ticks_count || 0);
    candlesCount = Number(counts?.candles_count || 0);
    signalsCount = Number(counts?.signals_count || 0);
    outcomesCount = Number(counts?.outcomes_count || 0);
    return { ok: true, runKey, marketsCount, ticksCount, candlesCount, signalsCount, outcomesCount };
  } catch (error) {
    await db(`collector_runs?${runFilter}`, { method: "PATCH", body: JSON.stringify({ finished_at: new Date().toISOString(), status: "failed", markets_count: marketsCount, ticks_count: ticksCount, candles_count: candlesCount, signals_count: signalsCount, outcomes_count: outcomesCount, error_message: String(error).slice(0, 1000) }), headers: { Prefer: "return=minimal" } }, Date.now() + 2_000).catch(() => null);
    throw error;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const url = new URL(req.url);
  if (req.method === "GET") {
    try { return json(await latestSnapshot()); }
    catch (error) { console.error(JSON.stringify({ event: "snapshot_unavailable", detail: String(error).slice(0, 300) })); return json({ error: "snapshot unavailable" }, 503); }
  }
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const deadlineAt = Date.now() + COLLECTOR_DEADLINE_MS;
  try {
    if (!(await authenticate(req, deadlineAt))) return json({ error: "unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    if (body.mode !== "collect") return json({ error: "unsupported mode" }, 400);
    return json(await collect(deadlineAt));
  } catch (error) {
    console.error(JSON.stringify({ event: "collector_failed", path: url.pathname, error: String(error) }));
    return json({ error: "collector failed", detail: String(error).slice(0, 400) }, 500);
  }
});
