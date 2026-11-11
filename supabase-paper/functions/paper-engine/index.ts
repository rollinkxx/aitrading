import { buildSignal, type Candle, type Depth, type Ticker } from "./_shared/strategy.ts";
import { evaluatePaperTick, type PaperConfig, type PaperSignal, type PaperState } from "./_shared/paper-engine.ts";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, apikey, x-paper-trigger",
  "access-control-allow-methods": "POST, OPTIONS",
  "content-type": "application/json; charset=utf-8",
};
const REQUEST_TIMEOUT_MS = 8_000;
const MARKET_DATA_BASE = "https://indodax.com";

type Json = Record<string, unknown>;
type PublicPosition = {
  market_id: string;
  signal_id: string;
  quantity: number;
  entry_price: number;
  entry_notional: number;
  entry_fee: number;
  stop_loss: number;
  take_profit: number;
  mark_price: number;
};
type PublicState = {
  initial_balance: number;
  active_pair: string;
  bot_status: "active" | "paused" | "stopped";
  cash_balance: number;
  equity: number;
  daily_start_equity: number;
  daily_loss_locked: boolean;
  position_size_pct: number;
  daily_loss_limit_pct: number;
  cfx_fee_rate: number;
  realized_pnl: number;
  open_positions: PublicPosition[];
};

function apiCredentials(): { key: string; headers: Record<string, string> } {
  const modern = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modern) {
    const keys = JSON.parse(modern) as Record<string, string>;
    const key = keys.default;
    if (!key) throw new Error("server_key_unavailable");
    return { key, headers: { apikey: key } };
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!legacy) throw new Error("server_key_unavailable");
  return {
    key: legacy,
    headers: { apikey: legacy, authorization: `Bearer ${legacy}` },
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");

async function rpc<T>(name: string, body: Json): Promise<T> {
  if (!SUPABASE_URL) throw new Error("supabase_url_unavailable");
  const credentials = apiCredentials();
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { ...credentials.headers, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`ledger_rpc_${name}_${response.status}`);
  return await response.json() as T;
}

async function publicJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`indodax_public_${response.status}`);
  return await response.json() as T;
}

function number(value: unknown): number {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new Error("invalid_market_number");
  return result;
}

function parseTicker(raw: Json): Ticker {
  const item = raw.ticker as Json | undefined;
  if (!item) throw new Error("ticker_missing");
  const source = number(item.server_time);
  const sourceTime = source < 1_000_000_000_000 ? source * 1000 : source;
  const ticker = {
    last: number(item.last),
    buy: number(item.buy),
    sell: number(item.sell),
    high: number(item.high),
    low: number(item.low),
    volume: number(item.vol_idr ?? item.volume ?? 0),
    sourceTime,
  };
  if (ticker.last <= 0 || ticker.buy <= 0 || ticker.sell < ticker.buy || ticker.low <= 0 || ticker.high < ticker.low || ticker.last < ticker.low || ticker.last > ticker.high) {
    throw new Error("ticker_invalid_ranges");
  }
  const age = Date.now() - sourceTime;
  if (!Number.isFinite(age) || age > 120_000 || age < -60_000) throw new Error("ticker_stale");
  return ticker;
}

function parseDepth(raw: Json): Depth {
  const normalize = (value: unknown): [number, number][] => Array.isArray(value)
    ? value.slice(0, 30).flatMap((level): [number, number][] => {
      if (!Array.isArray(level) || level.length < 2) return [];
      const price = Number(level[0]);
      const size = Number(level[1]);
      return Number.isFinite(price) && price > 0 && Number.isFinite(size) && size > 0 ? [[price, size]] : [];
    })
    : [];
  return { buy: normalize(raw.buy), sell: normalize(raw.sell) };
}

async function fetchCandles(pair: string, timeframe: "15" | "60" | "240", bars = 260): Promise<Candle[]> {
  const intervalSeconds = Number(timeframe) * 60;
  const to = Math.floor(Date.now() / 1000);
  const from = to - intervalSeconds * bars;
  const query = new URLSearchParams({ from: String(from), to: String(to), symbol: pair, tf: timeframe });
  const raw = await publicJson<unknown>(`${MARKET_DATA_BASE}/tradingview/history_v2?${query}`);
  if (!Array.isArray(raw)) throw new Error("candles_not_array");
  const intervalMs = Number(timeframe) * 60_000;
  return raw.map((row): Candle => {
    const item = row as Json;
    return {
      time: number(item.Time) * 1000,
      open: number(item.Open),
      high: number(item.High),
      low: number(item.Low),
      close: number(item.Close),
      volume: number(item.Volume ?? 0),
    };
  }).filter(candle => candle.time > 0
    && [candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite)
    && candle.open > 0 && candle.high > 0 && candle.low > 0 && candle.close > 0 && candle.volume >= 0
    && candle.high >= Math.max(candle.open, candle.close)
    && candle.low <= Math.min(candle.open, candle.close)
    && candle.time + intervalMs <= Date.now())
    .sort((a, b) => a.time - b.time)
    .slice(-bars);
}

async function fetchSignal(pair: string) {
  const [tickerRaw, depthRaw, c15Result, c60Result, c240Result] = await Promise.all([
    publicJson<Json>(`${MARKET_DATA_BASE}/api/ticker/${encodeURIComponent(pair)}`),
    publicJson<Json>(`${MARKET_DATA_BASE}/api/depth/${encodeURIComponent(pair)}`),
    fetchCandles(pair, "15").then(value => ({ value })).catch(() => ({ value: [] as Candle[] })),
    fetchCandles(pair, "60").then(value => ({ value })).catch(() => ({ value: [] as Candle[] })),
    fetchCandles(pair, "240").then(value => ({ value })).catch(() => ({ value: [] as Candle[] })),
  ]);
  const ticker = parseTicker(tickerRaw);
  const depth = parseDepth(depthRaw);
  const c15 = c15Result.value;
  const c60 = c60Result.value;
  const c240 = c240Result.value;
  const signal = buildSignal(c15, c60, c240, ticker, depth);
  const lastClosed = c15[c15.length - 1];
  const signalCandleTime = lastClosed?.time ?? ticker.sourceTime;
  const signalId = `${pair}|15m:${signalCandleTime}|${signal.type}`;
  const expiresAt = lastClosed ? new Date(lastClosed.time + 30 * 60_000).toISOString() : null;
  return {
    market_id: pair,
    signal_id: signalId,
    signal_type: signal.type,
    quality: signal.quality,
    expires_at: expiresAt,
    entry_low: signal.entryLow,
    entry_high: signal.entryHigh,
    stop_loss: signal.stopLoss,
    take_profit: signal.takeProfit,
    bid: ticker.buy,
    ask: ticker.sell,
    last: ticker.last,
    source_at: new Date(ticker.sourceTime).toISOString(),
    price_source: "indodax_public_api",
  };
}

async function processPair(pair: string, runToken: string, publicState: PublicState): Promise<string> {
  const event = await fetchSignal(pair);
  const config: PaperConfig = {
    initialBalance: Number(publicState.initial_balance),
    maxPositionPct: Number(publicState.position_size_pct),
    maxDailyLossPct: Number(publicState.daily_loss_limit_pct),
    cfxFeeRate: Number(publicState.cfx_fee_rate),
  };
  const state: PaperState = {
    botStatus: publicState.bot_status,
    activePair: publicState.active_pair,
    cash: Number(publicState.cash_balance),
    equity: Number(publicState.equity),
    dayStartEquity: Number(publicState.daily_start_equity),
    dailyLocked: publicState.daily_loss_locked,
    dailyRealizedPnl: Number(publicState.realized_pnl),
    openPositions: publicState.open_positions.map(position => ({
      marketId: position.market_id,
      quantity: Number(position.quantity),
      entryPrice: Number(position.entry_price),
      entryNotional: Number(position.entry_notional),
      entryFee: Number(position.entry_fee),
      stopLoss: Number(position.stop_loss),
      takeProfit: Number(position.take_profit),
      markPrice: Number(position.mark_price),
      signalId: position.signal_id,
    })),
    processedEventKeys: [],
  };
  const signal: PaperSignal = {
    id: event.signal_id,
    type: event.signal_type as PaperSignal["type"],
    quality: event.quality as PaperSignal["quality"],
    expiresAt: event.expires_at,
    entryLow: event.entry_low,
    entryHigh: event.entry_high,
    stopLoss: event.stop_loss,
    takeProfit: event.take_profit,
  };
  const quote = {
    marketId: pair,
    bid: event.bid,
    ask: event.ask,
    last: event.last,
    sourceTime: Date.parse(event.source_at),
  };
  const engineDecision = evaluatePaperTick({ nowMs: Date.now(), config, state, signal, quote })[0];
  const eventPayload = {
    ...event,
    engine_action: engineDecision?.action ?? "hold",
    engine_reason: engineDecision?.reason ?? "no_decision",
  };
  const result = await rpc<Json>("process_paper_tick", { p_run_token: runToken, p_event: eventPayload });
  return String(result.status ?? "processed");
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

async function runPaperBot(): Promise<Json> {
  const publicState = await rpc<PublicState>("get_paper_public_state", {});
  if (!publicState?.active_pair) throw new Error("paper_config_missing");
  const markets = [...new Set([...(publicState.bot_status === "active" ? [publicState.active_pair] : []), ...publicState.open_positions.map(position => position.market_id)])]
    .filter(pair => /^[a-z0-9]{2,20}idr$/.test(pair));
  if (!markets.length) return { status: "idle", markets: 0 };

  const runToken = crypto.randomUUID();
  const claimed = await rpc<boolean>("claim_paper_run", { p_run_token: runToken });
  if (!claimed) return { status: "skipped_locked", markets: markets.length };

  const results: string[] = [];
  const failures: string[] = [];
  try {
    for (const group of chunks(markets, 2)) {
      const batch = await Promise.allSettled(group.map(pair => processPair(pair, runToken, publicState)));
      for (let i = 0; i < batch.length; i++) {
        const item = batch[i];
        if (item.status === "fulfilled") results.push(item.value);
        else failures.push(`${group[i]}:market_data_or_ledger_unavailable`);
      }
    }
  } finally {
    await rpc<boolean>("release_paper_run", { p_run_token: runToken }).catch(() => false);
  }
  return { status: failures.length ? "partial" : "ok", markets: markets.length, results, failures };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405, headers: CORS_HEADERS });
  const triggerSecret = request.headers.get("x-paper-trigger");
  if (!triggerSecret || triggerSecret.length < 32) return Response.json({ error: "unauthorized" }, { status: 401, headers: CORS_HEADERS });
  try {
    const valid = await rpc<boolean>("verify_paper_trigger_secret", { p_presented_secret: triggerSecret });
    if (!valid) return Response.json({ error: "unauthorized" }, { status: 401, headers: CORS_HEADERS });
    const result = await runPaperBot();
    return Response.json(result, { headers: CORS_HEADERS });
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 80) : "paper_run_failed";
    console.error("paper-engine-run-failed", code);
    return Response.json({ error: "paper_run_failed", code }, { status: 500, headers: CORS_HEADERS });
  }
});
