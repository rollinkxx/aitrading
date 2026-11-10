import { validTicker, type MarketTicker } from "./market-quality.ts";

export const DEFAULT_MAX_SIGNAL_MARKETS = 8;
export const MIN_24H_VOLUME_IDR = 1_000_000_000;
export const MAX_TICKER_SPREAD_PERCENT = 0.8;

export type DiscoveryMarket = {
  id: string;
  status: string;
};

export type DiscoveryTicker = MarketTicker & {
  volume: number;
  sourceTime: number;
};

export type SignalMarket = DiscoveryMarket & {
  ticker: DiscoveryTicker;
};

export function selectSignalMarkets(
  markets: DiscoveryMarket[],
  tickers: Map<string, DiscoveryTicker>,
  now: number,
  maxMarkets = DEFAULT_MAX_SIGNAL_MARKETS,
): SignalMarket[] {
  if (!Number.isInteger(maxMarkets) || maxMarkets < 1) return [];

  return markets
    .filter((market) => market.status === "active")
    .map((market) => ({ market, ticker: tickers.get(market.id) }))
    .filter((entry): entry is { market: DiscoveryMarket; ticker: DiscoveryTicker } => {
      const { ticker } = entry;
      if (!ticker || !validTicker(ticker)) return false;
      if (!Number.isFinite(ticker.sourceTime) || ticker.sourceTime <= 0) return false;
      const age = now - ticker.sourceTime;
      if (age < -60_000 || age > 120_000) return false;
      if (ticker.volume < MIN_24H_VOLUME_IDR) return false;
      const spreadPercent = ((ticker.sell - ticker.buy) / ticker.last) * 100;
      return Number.isFinite(spreadPercent) && spreadPercent <= MAX_TICKER_SPREAD_PERCENT;
    })
    .sort((left, right) => {
      const volumeOrder = right.ticker.volume - left.ticker.volume;
      return volumeOrder || left.market.id.localeCompare(right.market.id);
    })
    .slice(0, maxMarkets)
    .map(({ market, ticker }) => ({ ...market, ticker }));
}
