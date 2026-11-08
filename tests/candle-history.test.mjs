import test from 'node:test'
import assert from 'node:assert/strict'
import { closedCandles, historyIssue } from '../supabase/functions/_shared/candle-history.ts'

const now = 1_800_000_000_000
const bar = time => ({ time, open: 100, high: 105, low: 95, close: 102, volume: 10 })
const history = (count, interval, end = now) => {
  const latestClosedOpen = Math.floor(end / interval) * interval - interval
  return Array.from({ length: count }, (_, index) => bar(latestClosedOpen - (count - index - 1) * interval))
}

test('closedCandles excludes the active candle for each requested timeframe', () => {
  const interval = 15 * 60_000
  const currentOpen = Math.floor(now / interval) * interval
  const bars = [...history(3, interval), bar(currentOpen)]
  assert.equal(closedCandles(bars, '15', now).length, 3)
})

test('historyIssue accepts sufficient, contiguous, recently closed bars', () => {
  const frames = [
    ['15', 60, 15 * 60_000],
    ['60', 200, 60 * 60_000],
    ['240', 150, 240 * 60_000],
  ]
  for (const [timeframe, count, interval] of frames) {
    assert.equal(historyIssue(history(count, interval), timeframe, count, now), null)
  }
})

test('historyIssue rejects bars that are fewer than the required long EMA window', () => {
  assert.equal(historyIssue(history(60, 60 * 60_000), '60', 200, now)?.quality, 'insufficient')
  assert.equal(historyIssue(history(60, 240 * 60_000), '240', 150, now)?.quality, 'insufficient')
})

test('historyIssue marks old history stale even if it contains enough bars', () => {
  const old = history(220, 60 * 60_000, now - 365 * 24 * 60 * 60_000)
  assert.equal(historyIssue(old, '60', 200, now)?.quality, 'stale')
})

test('historyIssue fails closed on duplicated bars and large time gaps', () => {
  const bars = history(220, 15 * 60_000)
  bars[150] = { ...bars[150], time: bars[150].time + 5 * 15 * 60_000 }
  assert.equal(historyIssue(bars, '15', 60, now)?.quality, 'insufficient')
})
