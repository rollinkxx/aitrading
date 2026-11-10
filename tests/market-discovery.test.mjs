import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_MAX_SIGNAL_MARKETS,
  MAX_TICKER_SPREAD_PERCENT,
  MIN_24H_VOLUME_IDR,
  selectSignalMarkets,
} from '../supabase/functions/_shared/market-discovery.ts'

const now = 1_800_000_000_000
const ticker = (volume, overrides = {}) => ({
  last: 100,
  buy: 99.8,
  sell: 100.2,
  high: 110,
  low: 90,
  volume,
  sourceTime: now - 10_000,
  ...overrides,
})
const market = (id, status = 'active') => ({ id, status })

test('selects only active, fresh, valid, minimum-turnover, narrow-spread markets', () => {
  const markets = [market('good'), market('suspended', 'suspended'), market('stale'), market('thin'), market('wide')]
  const tickers = new Map([
    ['good', ticker(MIN_24H_VOLUME_IDR)],
    ['suspended', ticker(MIN_24H_VOLUME_IDR * 10)],
    ['stale', ticker(MIN_24H_VOLUME_IDR, { sourceTime: now - 120_001 })],
    ['thin', ticker(MIN_24H_VOLUME_IDR - 1)],
    ['wide', ticker(MIN_24H_VOLUME_IDR, { buy: 98, sell: 102 })],
  ])

  assert.deepEqual(selectSignalMarkets(markets, tickers, now).map(({ id }) => id), ['good'])
})

test('ranks by turnover and applies deterministic id tie-break before limiting', () => {
  const markets = Array.from({ length: DEFAULT_MAX_SIGNAL_MARKETS + 2 }, (_, index) => market(`m${String(index).padStart(2, '0')}`))
  const tickers = new Map(markets.map(({ id }, index) => [id, ticker(MIN_24H_VOLUME_IDR * (index < 3 ? 2 : 1))]))
  const selected = selectSignalMarkets(markets, tickers, now)

  assert.equal(selected.length, DEFAULT_MAX_SIGNAL_MARKETS)
  assert.deepEqual(selected.slice(0, 3).map(({ id }) => id), ['m00', 'm01', 'm02'])
  assert.deepEqual(selected.slice(3).map(({ id }) => id), ['m03', 'm04', 'm05', 'm06', 'm07'])
})

test('rejects future timestamps outside the allowed clock-skew window', () => {
  const markets = [market('future')]
  const tickers = new Map([['future', ticker(MIN_24H_VOLUME_IDR, { sourceTime: now + 60_001 })]])
  assert.deepEqual(selectSignalMarkets(markets, tickers, now), [])
})

test('uses the same 0.8 percent spread ceiling as actionable strategy signals', () => {
  assert.equal(MAX_TICKER_SPREAD_PERCENT, 0.8)
  const markets = [market('pass'), market('fail')]
  const tickers = new Map([
    ['pass', ticker(MIN_24H_VOLUME_IDR, { buy: 99.61, sell: 100.39 })],
    ['fail', ticker(MIN_24H_VOLUME_IDR * 2, { buy: 99, sell: 101 })],
  ])
  assert.deepEqual(selectSignalMarkets(markets, tickers, now).map(({ id }) => id), ['pass'])
})
