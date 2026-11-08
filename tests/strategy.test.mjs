import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSignal, rsi } from '../src/lib/strategy.ts'

function candles(direction, count = 220, interval = 900_000, now = Date.now()) {
  const latestClosedOpen = Math.floor(now / interval) * interval - interval
  return Array.from({ length: count }, (_, i) => {
    const close = direction === 'up' ? 100 + i : 320 - i
    const open = direction === 'up' ? close - 0.5 : close + 0.5
    return {
      time: latestClosedOpen - (count - 1 - i) * interval,
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: i === count - 1 ? 200 : 100,
    }
  })
}

function history(direction, count = 220, now = Date.now()) {
  return {
    c15: candles(direction, count, 15 * 60_000, now),
    c60: candles(direction, count, 60 * 60_000, now),
    c240: candles(direction, count, 240 * 60_000, now),
  }
}

const depth = {
  buy: Array.from({ length: 10 }, (_, i) => [100 - i * 0.01, 20]),
  sell: Array.from({ length: 10 }, (_, i) => [102 + i * 0.01, 20]),
}
function ticker(last, sourceTime = Date.now()) {
  return { last, buy: last - 0.1, sell: last + 0.1, high: last + 10, low: last - 10, volume: 1_000, sourceTime }
}

test('RSI treats a flat market as neutral while preserving rising/falling extremes', () => {
  assert.equal(rsi(Array(30).fill(100)), 50)
  assert.equal(rsi(Array.from({ length: 30 }, (_, i) => 100 + i)), 100)
  assert.equal(rsi(Array.from({ length: 30 }, (_, i) => 130 - i)), 0)
})

 test('stale ticker timestamps fail closed to WAIT', () => {
  const frames = history('up')
  const signal = buildSignal(frames.c15, frames.c60, frames.c240, ticker(319, Date.now() - 180_000), depth)
  assert.equal(signal.type, 'WAIT')
  assert.equal(signal.quality, 'stale')
})

test('stale candle history fails closed even when the ticker is fresh', () => {
  const frames = history('up', 220, Date.now() - 365 * 24 * 60 * 60_000)
  const signal = buildSignal(frames.c15, frames.c60, frames.c240, ticker(319), depth)
  assert.equal(signal.type, 'WAIT')
  assert.equal(signal.quality, 'stale')
})

test('history shorter than the longest required EMA fails closed to WAIT', () => {
  const frames = history('up')
  const signal = buildSignal(frames.c15, candles('up', 60, 60 * 60_000), candles('up', 60, 240 * 60_000), ticker(319), depth)
  assert.equal(signal.type, 'WAIT')
  assert.equal(signal.quality, 'insufficient')
})

test('an in-progress candle cannot satisfy the minimum closed 15-minute history', () => {
  const now = Date.now()
  const frames = history('up', 59, now)
  frames.c15.push({
    time: Math.floor(now / (15 * 60_000)) * 15 * 60_000,
    open: 159,
    high: 161,
    low: 158,
    close: 160,
    volume: 500,
  })
  const signal = buildSignal(frames.c15, frames.c60, frames.c240, ticker(160), depth)
  assert.equal(signal.type, 'WAIT')
  assert.equal(signal.quality, 'insufficient')
})

test('large gaps in candle history fail closed to WAIT', () => {
  const frames = history('up')
  frames.c15[150].time += 5 * 15 * 60_000
  const signal = buildSignal(frames.c15, frames.c60, frames.c240, ticker(319), depth)
  assert.equal(signal.type, 'WAIT')
  assert.equal(signal.quality, 'insufficient')
})

test('invalid OHLC candles fail closed to WAIT', () => {
  const frames = history('up')
  frames.c15[100] = { ...frames.c15[100], low: 0 }
  const signal = buildSignal(frames.c15, frames.c60, frames.c240, ticker(319), depth)
  assert.equal(signal.type, 'WAIT')
  assert.equal(signal.quality, 'insufficient')
})

test('invalid order book fails closed to WAIT', () => {
  const frames = history('up')
  const signal = buildSignal(frames.c15, frames.c60, frames.c240, ticker(319), { buy: [], sell: [] })
  assert.equal(signal.type, 'WAIT')
  assert.equal(signal.quality, 'insufficient')
})

test('bearish SELL has stop above and target below reference price', () => {
  const frames = history('down')
  const signal = buildSignal(frames.c15, frames.c60, frames.c240, ticker(101), depth)
  assert.equal(signal.type, 'SELL')
  assert.ok(signal.stopLoss > 101)
  assert.ok(signal.takeProfit < 101)
})
