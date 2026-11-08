export type Pair = { id: string; symbol: string; description: string; traded_currency_unit?: string; url_logo_png?: string; is_maintenance?: number; is_market_suspended?: number }
export type Ticker = { last: number; buy: number; sell: number; high: number; low: number; volume: number; sourceTime: number }
export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number }
export type Depth = { buy: [number, number][]; sell: [number, number][] }
export type StoredMarket = { id:string; symbol:string; base_asset:string; quote_asset:string; status:string; last_synced_at:string|null }
export type StoredTick = { market_id:string; last_price:number; best_bid:number; best_ask:number; volume_24h:number|null; high_24h:number|null; low_24h:number|null; source_timestamp:string; received_at:string; data_status:string }
export type StoredSignal = { id:string; market_id:string; signal_type:'BUY'|'SELL'|'HOLD'|'WAIT'; timeframe:string; confidence:number; reference_price:number|null; entry_low:number|null; entry_high:number|null; stop_loss:number|null; take_profit:number|null; risk_reward:number|null; reason_text:string; data_quality:string; created_at:string; expires_at:string|null; status:string }
export type CollectorRun = { started_at:string; finished_at:string|null; status:string; markets_count:number; ticks_count:number; candles_count:number; signals_count:number; outcomes_count:number }
export type StoredSnapshot = { markets:StoredMarket[]; ticks:StoredTick[]; signals:StoredSignal[]; latestRun:CollectorRun|null; servedAt:string }

const BASE = 'https://hlxiyprvygakfwreynvn.supabase.co/functions/v1/indodax-proxy'
const COLLECTOR = 'https://hlxiyprvygakfwreynvn.supabase.co/functions/v1/market-collector'
const REQUEST_TIMEOUT_MS = 12_000
async function fetchJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!response.ok) {
        if (attempt === 0 && (response.status === 429 || response.status >= 500)) continue
        throw new Error(`Market data ${response.status}`)
      }
      return await response.json() as T
    } catch (error) {
      lastError = error
      if (error instanceof Error && /^Market data \d+$/.test(error.message)) throw error
      if (attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, 200))
        continue
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Market data request failed')
}
const json = async <T>(path: string): Promise<T> => {
  return fetchJson<T>(`${BASE}${path}`, { headers: { Accept: 'application/json' } })
}

function numericField(raw: Record<string, unknown>, field: string, allowZero = false): number {
  const value = raw[field]
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    throw new Error(`Invalid ticker ${field}`)
  }
  const number = Number(value)
  if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0)) {
    throw new Error(`Invalid ticker ${field}`)
  }
  return number
}

export async function getPairs(): Promise<Pair[]> {
  const raw = await json<any[]>('/api/pairs')
  return raw.filter(pair => pair.id.endsWith('idr')).map(pair => ({
    ...pair,
    symbol: pair.symbol || pair.id.toUpperCase(),
    description: pair.description || pair.symbol,
  }))
}

export async function getSummaries(): Promise<Record<string, any>> {
  const raw = await json<{ tickers: Record<string, any> }>('/api/summaries')
  return Object.fromEntries(Object.entries(raw.tickers).map(([key, value]) => [key.replace('_', ''), value]))
}

export async function getStoredSnapshot(): Promise<StoredSnapshot> {
  return fetchJson<StoredSnapshot>(COLLECTOR, { headers: { Accept: 'application/json' }, cache: 'no-store' })
}

export function parseTicker(raw: any): Ticker {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid ticker payload')
  const last = numericField(raw, 'last')
  const buy = numericField(raw, 'buy')
  const sell = numericField(raw, 'sell')
  const high = numericField(raw, 'high')
  const low = numericField(raw, 'low')
  const volume = raw.vol_idr === undefined && raw.volume === undefined
    ? 0
    : numericField({ volume: raw.vol_idr ?? raw.volume }, 'volume', true)
  const sourceSecondsOrMs = numericField(raw, 'server_time')
  const sourceTime = sourceSecondsOrMs < 1_000_000_000_000
    ? sourceSecondsOrMs * 1000
    : sourceSecondsOrMs

  if (sell < buy || high < low || last < low || last > high) {
    throw new Error('Invalid ticker price ranges')
  }
  return { last, buy, sell, high, low, volume, sourceTime }
}

export async function getTicker(pair: string): Promise<Ticker> {
  const raw = await json<{ ticker: any }>(`/api/ticker/${encodeURIComponent(pair)}`)
  return parseTicker(raw.ticker)
}

export async function getDepth(pair: string): Promise<Depth> {
  const raw = await json<any>(`/api/depth/${encodeURIComponent(pair)}`)
  const normalize = (levels: any): [number, number][] => {
    if (!Array.isArray(levels)) return []
    return levels
      .filter((level: any) => Array.isArray(level) && level.length >= 2)
      .map((level: any[]) => [Number(level[0]), Number(level[1])] as [number, number])
      .filter(([price, size]) => Number.isFinite(price) && price > 0 && Number.isFinite(size) && size > 0)
      .slice(0, 30)
  }
  return { buy: normalize(raw.buy), sell: normalize(raw.sell) }
}

export async function getCandles(pair: string, tf: string, bars = 260): Promise<Candle[]> {
  if (!['15', '60', '240'].includes(tf)) throw new Error(`Invalid candle timeframe: ${tf}`)
  const intervalMs = Number(tf) * 60_000
  if (!Number.isInteger(bars) || bars <= 0 || bars > 300) throw new Error(`Invalid candle limit: ${bars}`)
  const to = Math.floor(Date.now() / 1000)
  const from = to - (intervalMs / 1000) * bars
  const query = new URLSearchParams({ from: String(from), to: String(to), symbol: pair, tf })
  const raw = await json<any[]>(`/tradingview/history_v2?${query}`)
  const now = Date.now()

  return raw.map(candle => ({
    time: Number(candle.Time) * 1000,
    open: Number(candle.Open),
    high: Number(candle.High),
    low: Number(candle.Low),
    close: Number(candle.Close),
    volume: Number(candle.Volume ?? 0),
  }))
    .filter(candle => Number.isFinite(candle.time) && candle.time > 0)
    .filter(candle => [candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite))
    .filter(candle => candle.open > 0 && candle.high > 0 && candle.low > 0 && candle.close > 0 && candle.volume >= 0)
    .filter(candle => candle.high >= Math.max(candle.open, candle.close) && candle.low <= Math.min(candle.open, candle.close))
    .filter(candle => candle.time + intervalMs <= now)
    .sort((left, right) => left.time - right.time)
    .slice(-bars)
}

export function freshness(sourceTime: number, maxAgeMs = 120_000) {
  const age = Date.now() - sourceTime
  const stale = age > maxAgeMs || age < -60_000
  return { ageMs: age, stale, label: age < 10_000 && age >= -60_000 ? 'live' : `${Math.max(1, Math.round(age / 1000))} dtk lalu` }
}
