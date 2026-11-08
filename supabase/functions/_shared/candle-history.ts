export type CandleHistoryBar = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type HistoryIssue = { quality: "stale" | "insufficient"; reason: string };

export function closedCandles<T extends CandleHistoryBar>(candles: T[], timeframe: string, now: number): T[] {
  const interval = Number(timeframe) * 60_000;
  if (!Number.isFinite(interval) || interval <= 0) return [];
  return candles.filter(candle => Number.isFinite(candle.time) && candle.time > 0 && candle.time + interval <= now)
    .sort((left, right) => left.time - right.time);
}

export function historyIssue<T extends CandleHistoryBar>(candles: T[], timeframe: string, minimum: number, now: number): HistoryIssue | null {
  const interval = Number(timeframe) * 60_000;
  if (!Number.isFinite(interval) || interval <= 0 || !Number.isInteger(minimum) || minimum <= 0) {
    return { quality: "insufficient", reason: "Konfigurasi history candle tidak valid; sinyal dihentikan." };
  }
  const closed = closedCandles(candles, timeframe, now);
  if (closed.length < minimum) {
    return { quality: "insufficient", reason: `Riwayat ${timeframe}M belum cukup (${closed.length}/${minimum} candle tertutup).` };
  }
  for (let index = 1; index < closed.length; index++) {
    const gap = closed[index].time - closed[index - 1].time;
    if (gap <= 0 || gap > interval * 2) {
      return { quality: "insufficient", reason: `Riwayat ${timeframe}M memiliki duplikasi atau celah; sinyal dihentikan.` };
    }
  }
  const latest = closed[closed.length - 1];
  if (!latest || now - (latest.time + interval) > interval * 2) {
    return { quality: "stale", reason: `Riwayat ${timeframe}M terlalu lama; sinyal dihentikan.` };
  }
  return null;
}
