export type MarketTicker = {
  last: number;
  buy: number;
  sell: number;
  high: number;
  low: number;
  volume?: number;
};

export type MarketDepth = {
  buy: [number, number][];
  sell: [number, number][];
}

export function normalizeSourceTimestamp(value: unknown): number | null {
  const raw = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const milliseconds = raw < 1_000_000_000_000 ? raw * 1000 : raw;
  return Number.isFinite(milliseconds) && milliseconds > 0 ? milliseconds : null;
}

export function validTicker(ticker: MarketTicker): boolean {
  const prices = [ticker.last, ticker.buy, ticker.sell, ticker.high, ticker.low];
  if (!prices.every(Number.isFinite) || prices.some(price => price <= 0)) return false;
  if (ticker.buy > ticker.sell || ticker.high < ticker.low) return false;
  if (ticker.last < ticker.low || ticker.last > ticker.high) return false;
  if (ticker.volume !== undefined && (!Number.isFinite(ticker.volume) || ticker.volume < 0)) return false;
  return true;
}

export function validDepth(depth: MarketDepth): boolean {
  if (!depth || !Array.isArray(depth.buy) || !Array.isArray(depth.sell) || !depth.buy.length || !depth.sell.length) return false;
  const validLevels = (levels: [number, number][]) => levels.every(level =>
    Array.isArray(level) && level.length >= 2 && Number.isFinite(level[0]) && Number.isFinite(level[1]) && level[0] > 0 && level[1] > 0,
  );
  if (!validLevels(depth.buy) || !validLevels(depth.sell)) return false;
  for (let i = 1; i < depth.buy.length; i++) if (depth.buy[i - 1][0] < depth.buy[i][0]) return false;
  for (let i = 1; i < depth.sell.length; i++) if (depth.sell[i - 1][0] > depth.sell[i][0]) return false;
  return depth.buy[0][0] <= depth.sell[0][0];
}

export function validMarketData(ticker: MarketTicker, depth: MarketDepth): boolean {
  return validTicker(ticker) && validDepth(depth);
}

export function normalizeDepth(raw: unknown, maxLevels = 30): MarketDepth | null {
  if (!raw || typeof raw !== 'object' || !Number.isInteger(maxLevels) || maxLevels < 1) return null;
  const value = raw as { buy?: unknown; sell?: unknown };
  if (!Array.isArray(value.buy) || !Array.isArray(value.sell)) return null;
  const parseSide = (side: unknown[]): [number, number][] | null => {
    const levels = side.slice(0, maxLevels).map((row): [number, number] | null => {
      if (!Array.isArray(row) || row.length < 2) return null;
      const price = Number(row[0]);
      const size = Number(row[1]);
      return [price, size];
    });
    if (levels.some(level => level === null)) return null;
    return levels as [number, number][];
  };
  const buy = parseSide(value.buy);
  const sell = parseSide(value.sell);
  if (!buy || !sell) return null;
  const depth = { buy, sell };
  return validDepth(depth) ? depth : null;
}
