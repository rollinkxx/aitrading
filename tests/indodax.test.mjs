import test from 'node:test'
import assert from 'node:assert/strict'
import { getCandles, parseTicker } from '../src/lib/indodax.ts'

const validTicker = {
  last: '1369990000',
  buy: '1369990000',
  sell: '1369999000',
  high: '1376808000',
  low: '1367430000',
  vol_idr: '14238236252',
  server_time: 1_794_101_993,
}

test('parses a valid official Indodax ticker with a positive price', () => {
  const ticker = parseTicker(validTicker)
  assert.equal(ticker.last, 1_369_990_000)
  assert.equal(ticker.buy, 1_369_990_000)
  assert.equal(ticker.sell, 1_369_999_000)
  assert.equal(ticker.high, 1_376_808_000)
  assert.equal(ticker.low, 1_367_430_000)
  assert.equal(ticker.volume, 14_238_236_252)
  assert.equal(ticker.sourceTime, 1_794_101_993_000)
})

test('preserves millisecond timestamps and rejects malformed or unsafe ticker payloads', () => {
  assert.equal(parseTicker({ ...validTicker, server_time: 1_794_101_993_000 }).sourceTime, 1_794_101_993_000)
  for (const payload of [
    { ...validTicker, last: '0' },
    { ...validTicker, last: '-1' },
    { ...validTicker, sell: '1369980000' },
    { ...validTicker, high: '1360000000' },
    { ...validTicker, low: '0' },
    { ...validTicker, server_time: 'not-a-time' },
    { ...validTicker, vol_idr: '-1' },
  ]) {
    assert.throws(() => parseTicker(payload), /ticker/i)
  }
})

test('returns only valid, fully closed candles from official OHLC history', async () => {
  const originalFetch = globalThis.fetch
  const interval = 15 * 60_000
  const currentOpen = Math.floor(Date.now() / interval) * interval
  const closedOpen = currentOpen - interval
  const toRaw = (time, values) => ({
    Time: Math.floor(time / 1000),
    Open: values[0],
    High: values[1],
    Low: values[2],
    Close: values[3],
    Volume: values[4],
  })
  const rows = [
    toRaw(closedOpen, [100, 110, 95, 105, 12]),
    toRaw(currentOpen, [105, 115, 100, 110, 15]),
    toRaw(closedOpen - interval, [100, 90, 95, 105, 12]),
  ]
  globalThis.fetch = async () => new Response(JSON.stringify(rows), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
  try {
    const candles = await getCandles('btcidr', '15', 10)
    assert.deepEqual(candles.map(candle => candle.time), [closedOpen])
    assert.ok(candles.every(candle => candle.low > 0 && candle.volume >= 0))
  } finally {
    globalThis.fetch = originalFetch
  }
})
