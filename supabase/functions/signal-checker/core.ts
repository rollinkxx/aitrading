export type Signal = {
  id: string;
  market_id: string;
  signal_type: "BUY" | "SELL" | "HOLD" | "WAIT";
  reference_price: number | string | null;
  stop_loss: number | string | null;
  take_profit: number | string | null;
};

export type SummaryTicker = {
  last?: number | string;
  server_time?: number | string;
};

export type Outcome = {
  signalId: string;
  exitPrice: number;
  returnPercentage: number;
  outcome: "stop_loss" | "take_profit";
};

const MAX_AGE_MS = 90_000;
const MAX_FUTURE_SKEW_MS = 60_000;

export function fullCollectorOwnsThisMinute(nowMs: number): boolean {
  return new Date(nowMs).getUTCMinutes() % 5 === 0;
}

export function freshPrice(ticker: SummaryTicker | null | undefined, nowMs: number): number | null {
  if (!ticker) return null;
  const price = Number(ticker.last);
  const rawTime = Number(ticker.server_time);
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(rawTime) || rawTime <= 0) return null;
  const sourceTime = rawTime < 1_000_000_000_000 ? rawTime * 1000 : rawTime;
  const age = nowMs - sourceTime;
  if (age > MAX_AGE_MS || age < -MAX_FUTURE_SKEW_MS) return null;
  return price;
}

export function evaluateOutcome(signal: Signal, ticker: SummaryTicker | null | undefined, nowMs: number): Outcome | null {
  if (signal.signal_type !== "BUY" && signal.signal_type !== "SELL") return null;
  const price = freshPrice(ticker, nowMs);
  const reference = Number(signal.reference_price);
  const stop = Number(signal.stop_loss);
  const target = Number(signal.take_profit);
  if (price === null || !Number.isFinite(reference) || reference <= 0 || !Number.isFinite(stop) || stop <= 0 || !Number.isFinite(target) || target <= 0) return null;

  const stopHit = signal.signal_type === "BUY" ? price <= stop : price >= stop;
  const targetHit = signal.signal_type === "BUY" ? price >= target : price <= target;
  if (!stopHit && !targetHit) return null;

  return {
    signalId: signal.id,
    exitPrice: price,
    returnPercentage: ((price - reference) / reference) * 100 * (signal.signal_type === "SELL" ? -1 : 1),
    outcome: stopHit ? "stop_loss" : "take_profit",
  };
}
