import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeDepth, validDepth, validMarketData, validTicker } from '../supabase/functions/_shared/market-quality.ts'

const ticker = { last: 100, buy: 99, sell: 101, high: 110, low: 90, volume: 1000 }
const depth = { buy: [[99, 2], [98, 3]], sell: [[101, 2], [102, 3]] }

test('valid ticker requires positive ordered quote and last within 24h range', () => {
  assert.equal(validTicker(ticker), true)
  assert.equal(validTicker({ ...ticker, last: 0 }), false)
  assert.equal(validTicker({ ...ticker, buy: 0 }), false)
  assert.equal(validTicker({ ...ticker, sell: ticker.buy - 1 }), false)
  assert.equal(validTicker({ ...ticker, last: ticker.high + 1 }), false)
  assert.equal(validTicker({ ...ticker, low: -1 }), false)
  assert.equal(validTicker({ ...ticker, volume: -1 }), false)
  assert.equal(validTicker({ ...ticker, volume: Number.NaN }), false)
})

test('valid depth requires positive finite levels, sorted sides, and a non-crossed top of book', () => {
  assert.equal(validDepth(depth), true)
  assert.equal(validDepth({ buy: [[99, 1], [100, 1]], sell: depth.sell }), false)
  assert.equal(validDepth({ buy: depth.buy, sell: [[102, 1], [101, 1]] }), false)
  assert.equal(validDepth({ buy: [[102, 1]], sell: [[101, 1]] }), false)
  assert.equal(validDepth({ buy: [[99, 0]], sell: [[101, 1]] }), false)
  assert.equal(validDepth({ buy: [[Number.POSITIVE_INFINITY, 1]], sell: [[101, 1]] }), false)
  assert.equal(validDepth({ buy: [], sell: [[101, 1]] }), false)
})

test('normalizer rejects malformed and crossed books instead of silently scoring them', () => {
  assert.deepEqual(normalizeDepth({ buy: [['99', '2']], sell: [['101', '3']] }), { buy: [[99, 2]], sell: [[101, 3]] })
  assert.equal(normalizeDepth({ buy: [[99, 1]], sell: [[98, 1]] }), null)
  assert.equal(normalizeDepth({ buy: [[99, 0]], sell: [[101, 1]] }), null)
  assert.equal(normalizeDepth({ buy: {}, sell: [] }), null)
})

test('combined validator rejects invalid quotes before persistence or signal generation', () => {
  assert.equal(validMarketData(ticker, depth), true)
  assert.equal(validMarketData({ ...ticker, buy: 102, sell: 101 }, depth), false)
  assert.equal(validMarketData(ticker, { buy: [[102, 1]], sell: [[101, 1]] }), false)
})
