export const CFX_FEE_RATE = 0.0000555;
export const PAPER_QUOTE_MAX_AGE_MS = 120_000;
export const PAPER_FUTURE_SKEW_MS = 60_000;

export type PaperSignal = {
  id: string;
  type: "BUY" | "SELL" | "HOLD" | "WAIT";
  quality: "validated" | "stale" | "insufficient";
  expiresAt: string | null;
  entryLow: number;
  entryHigh: number;
  stopLoss: number;
  takeProfit: number;
};

export type PaperQuote = {
  marketId: string;
  bid: number;
  ask: number;
  last: number;
  sourceTime: number;
};

export type PaperPosition = {
  marketId: string;
  quantity: number;
  entryPrice: number;
  entryNotional: number;
  entryFee: number;
  stopLoss: number;
  takeProfit: number;
  markPrice: number;
  signalId?: string;
};

export type PaperState = {
  botStatus: "active" | "paused" | "stopped";
  activePair: string;
  cash: number;
  equity: number;
  dayStartEquity: number;
  dailyLocked: boolean;
  dailyRealizedPnl: number;
  openPositions: PaperPosition[];
  processedEventKeys: string[];
};

export type PaperConfig = {
  initialBalance: number;
  maxPositionPct: number;
  maxDailyLossPct: number;
  cfxFeeRate: number;
};

export type PaperDecision = {
  action: "open" | "close" | "mark" | "hold" | "reject" | "duplicate";
  eventKey: string | null;
  marketId: string;
  signalId: string;
  price: number;
  notional: number;
  quantity?: number;
  fee: number;
  exitFee?: number;
  realizedNetPnl?: number;
  outcome?: "win" | "loss" | "breakeven";
  reason: string;
  triggerPrice?: number;
};

export type EvaluatePaperTickInput = {
  nowMs: number;
  config: PaperConfig;
  state: PaperState;
  signal: PaperSignal;
  quote: PaperQuote;
};

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function isFreshQuote(quote: PaperQuote, nowMs: number): boolean {
  const age = nowMs - quote.sourceTime;
  return Number.isFinite(quote.sourceTime)
    && quote.sourceTime > 0
    && age <= PAPER_QUOTE_MAX_AGE_MS
    && age >= -PAPER_FUTURE_SKEW_MS
    && finitePositive(quote.bid)
    && finitePositive(quote.ask)
    && finitePositive(quote.last)
    && quote.ask >= quote.bid;
}

function validSignal(signal: PaperSignal, nowMs: number): boolean {
  if (signal.quality !== "validated") return false;
  if (signal.expiresAt !== null) {
    const expiresAt = Date.parse(signal.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) return false;
  }
  return true;
}

function makeEventKey(marketId: string, signalId: string, action: string, sourceTime: number): string {
  return `${marketId}|${signalId}|${action}|${sourceTime}`;
}

function equityAtQuote(state: PaperState, quote: PaperQuote): number {
  return state.cash + state.openPositions.reduce((equity, position) => {
    const mark = position.marketId === quote.marketId ? quote.bid : position.markPrice;
    return equity + position.quantity * mark;
  }, 0);
}

function decision(
  action: PaperDecision["action"],
  quote: PaperQuote,
  signal: PaperSignal,
  reason: string,
  eventAction?: string,
  fields: Partial<PaperDecision> = {},
): PaperDecision {
  return {
    action,
    eventKey: eventAction ? makeEventKey(quote.marketId, signal.id, eventAction, quote.sourceTime) : null,
    marketId: quote.marketId,
    signalId: signal.id,
    price: quote.last,
    notional: 0,
    fee: 0,
    reason,
    ...fields,
  };
}

/**
 * Pure paper-only decision engine. It never calls exchange order APIs. Database RPCs
 * remain responsible for locking, persisted idempotency, and authoritative balances.
 */
export function evaluatePaperTick(input: EvaluatePaperTickInput): PaperDecision[] {
  const { nowMs, config, state, signal, quote } = input;
  const open = state.openPositions.find(position => position.marketId === quote.marketId);
  if (!isFreshQuote(quote, nowMs)) {
    return [decision("reject", quote, signal, "quote_stale_or_invalid")];
  }

  const equity = equityAtQuote(state, quote);
  const dailyLossLimit = state.dayStartEquity * config.maxDailyLossPct;
  const dailyLoss = Math.max(0, state.dayStartEquity - equity);
  const dailyLocked = state.dailyLocked || dailyLoss >= dailyLossLimit;

  if (open) {
    const stopHit = quote.bid <= open.stopLoss;
    const targetHit = quote.bid >= open.takeProfit;
    const hasValidExitSignal = validSignal(signal, nowMs) && signal.type === "SELL";
    if (stopHit || targetHit || hasValidExitSignal) {
      const reason = stopHit ? "stop_loss" : targetHit ? "take_profit" : "signal_sell";
      const exitNotional = open.quantity * quote.bid;
      const exitFee = exitNotional * config.cfxFeeRate;
      const realizedNetPnl = exitNotional - open.entryNotional - open.entryFee - exitFee;
      const outcome = realizedNetPnl > 0 ? "win" : realizedNetPnl < 0 ? "loss" : "breakeven";
      const triggerPrice = reason === "stop_loss" ? open.stopLoss : reason === "take_profit" ? open.takeProfit : undefined;
      return [decision("close", quote, signal, reason, "close", {
        price: quote.bid,
        notional: exitNotional,
        quantity: open.quantity,
        fee: exitFee,
        exitFee,
        realizedNetPnl,
        outcome,
        ...(triggerPrice === undefined ? {} : { triggerPrice }),
      })];
    }
    return [decision("mark", quote, signal, dailyLocked ? "daily_loss_limit_blocks_entries" : "position_open")];
  }

  if (state.processedEventKeys.includes(makeEventKey(quote.marketId, signal.id, "open", quote.sourceTime))) {
    return [decision("duplicate", quote, signal, "event_already_processed", "open")];
  }
  if (state.botStatus !== "active") {
    return [decision("reject", quote, signal, `bot_${state.botStatus.toLowerCase()}`)];
  }
  if (quote.marketId !== state.activePair) {
    return [decision("reject", quote, signal, "market_is_not_active_pair")];
  }
  if (dailyLocked) {
    return [decision("reject", quote, signal, "daily_loss_limit_reached")];
  }
  if (!validSignal(signal, nowMs) || signal.type !== "BUY") {
    return [decision("hold", quote, signal, "no_fresh_valid_buy_signal")];
  }
  if (![signal.entryLow, signal.entryHigh, signal.stopLoss, signal.takeProfit].every(finitePositive)
    || signal.entryLow > signal.entryHigh
    || signal.stopLoss >= quote.ask
    || signal.takeProfit <= quote.ask) {
    return [decision("reject", quote, signal, "invalid_buy_levels")];
  }
  if (quote.ask < signal.entryLow || quote.ask > signal.entryHigh) {
    return [decision("hold", quote, signal, "ask_outside_entry_range")];
  }
  if (state.openPositions.some(position => position.marketId === quote.marketId)) {
    return [decision("reject", quote, signal, "position_already_open")];
  }

  const maxNotional = Math.max(0, equity * config.maxPositionPct);
  const cashCapacity = Math.max(0, state.cash / (1 + config.cfxFeeRate));
  const notional = Math.min(maxNotional, cashCapacity);
  if (!finitePositive(notional)) return [decision("reject", quote, signal, "insufficient_shared_cash")];
  const fee = notional * config.cfxFeeRate;
  return [decision("open", quote, signal, "buy_signal_entry_range", "open", {
    price: quote.ask,
    notional,
    quantity: notional / quote.ask,
    fee,
  })];
}
