import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluatePaperTick } from '../supabase/functions/_shared/paper-engine.ts'

const config = {
  initialBalance: 100_000_000,
  maxPositionPct: 0.10,
  maxDailyLossPct: 0.02,
  cfxFeeRate: 0.0000555,
}

function state(overrides = {}) {
  return {
    botStatus: 'active',
    activePair: 'btcidr',
    cash: 100_000_000,
    equity: 100_000_000,
    dayStartEquity: 100_000_000,
    dailyLocked: false,
    dailyRealizedPnl: 0,
    openPositions: [],
    processedEventKeys: [],
    ...overrides,
  }
}

function signal(overrides = {}) {
  return {
    id: 'btcidr|15m:1000|BUY',
    type: 'BUY',
    quality: 'validated',
    expiresAt: new Date(200_000).toISOString(),
    entryLow: 99_000,
    entryHigh: 101_000,
    stopLoss: 98_000,
    takeProfit: 104_000,
    ...overrides,
  }
}

function quote(overrides = {}) {
  return { marketId: 'btcidr', bid: 99_900, ask: 100_000, last: 99_950, sourceTime: 100_000, ...overrides }
}

const tick = (overrides = {}) => ({ nowMs: 100_100, config, state: state(), signal: signal(), quote: quote(), ...overrides })

test('opens a validated BUY only when the fresh ask is inside the entry range and caps notional at 10% equity', () => {
  const decision = evaluatePaperTick(tick())[0]
  assert.equal(decision.action, 'open')
  assert.equal(decision.price, 100_000)
  assert.equal(decision.notional, 10_000_000)
  assert.equal(decision.fee, 555)
  assert.equal(decision.quantity, 100)
})

test('does not chase a BUY outside its entry range or process invalid, stale or expired inputs', () => {
  const cases = [
    tick({ quote: quote({ ask: 101_001 }) }),
    tick({ quote: quote({ sourceTime: 0 }) }),
    tick({ signal: signal({ quality: 'insufficient' }) }),
    tick({ signal: signal({ expiresAt: new Date(100_000).toISOString() }) }),
    tick({ signal: signal({ stopLoss: 0 }) }),
    tick({ signal: signal({ type: 'WAIT' }) }),
    tick({ signal: signal({ type: 'HOLD' }) }),
  ]
  for (const input of cases) assert.notEqual(evaluatePaperTick(input)[0]?.action, 'open')
})

test('one open position per market and processed event keys are idempotent', () => {
  const existing = { marketId: 'btcidr', quantity: 10, entryPrice: 90_000, entryNotional: 900_000, entryFee: 49.95, stopLoss: 80_000, takeProfit: 120_000, markPrice: 99_000 }
  const alreadyOpen = evaluatePaperTick(tick({ state: state({ openPositions: [existing] }) }))[0]
  assert.notEqual(alreadyOpen?.action, 'open')
  const duplicate = evaluatePaperTick(tick({ state: state({ processedEventKeys: ['btcidr|btcidr|15m:1000|BUY|open|100000'] }) }))[0]
  assert.equal(duplicate?.action, 'duplicate')
})

test('SELL closes a long at bid, charges exit CFX, and computes win/loss after both-side fees', () => {
  const position = { marketId: 'btcidr', quantity: 100, entryPrice: 100_000, entryNotional: 10_000_000, entryFee: 555, stopLoss: 95_000, takeProfit: 110_000, markPrice: 101_000, signalId: 'entry-1' }
  const decision = evaluatePaperTick(tick({
    state: state({ cash: 89_999_445, equity: 100_099_445, openPositions: [position] }),
    signal: signal({ id: 'sell-1', type: 'SELL' }),
    quote: quote({ bid: 102_000, ask: 102_100, last: 102_050, sourceTime: 100_050 }),
  }))[0]
  assert.equal(decision.action, 'close')
  assert.equal(decision.reason, 'signal_sell')
  assert.equal(decision.price, 102_000)
  assert.equal(decision.exitFee, 566.1)
  assert.equal(decision.realizedNetPnl, 198_878.9)
  assert.equal(decision.outcome, 'win')
})

test('stop loss takes precedence over take profit and sells at the observed bid on a gap', () => {
  const position = { marketId: 'btcidr', quantity: 1, entryPrice: 100, entryNotional: 100, entryFee: 0.00555, stopLoss: 95, takeProfit: 105, markPrice: 100 }
  const decision = evaluatePaperTick(tick({
    state: state({ cash: 99_899.99445, equity: 100_000, openPositions: [position] }),
    quote: quote({ bid: 94, ask: 95, last: 94.5, sourceTime: 100_050 }),
  }))[0]
  assert.equal(decision.action, 'close')
  assert.equal(decision.reason, 'stop_loss')
  assert.equal(decision.price, 94)
  assert.equal(decision.outcome, 'loss')
})

test('daily drawdown blocks new entries but does not block exits', () => {
  const locked = evaluatePaperTick(tick({ state: state({ dailyLocked: true }) }))[0]
  assert.notEqual(locked?.action, 'open')
  const position = { marketId: 'btcidr', quantity: 1, entryPrice: 100_000, entryNotional: 100_000, entryFee: 5.55, stopLoss: 95_000, takeProfit: 110_000, markPrice: 100_000 }
  const exit = evaluatePaperTick(tick({
    state: state({ dailyLocked: true, cash: 99_894.45, openPositions: [position] }),
    quote: quote({ bid: 94_000, ask: 94_100, last: 94_050, sourceTime: 100_050 }),
  }))[0]
  assert.equal(exit?.action, 'close')
})
