import test from 'node:test'
import assert from 'node:assert/strict'
import { indodaxTarget } from '../supabase/functions/indodax-proxy/policy.ts'

const now = 1_800_000_000
const request = path => new URL(`https://project.supabase.co${path}`)

test('allows only the public market endpoints used by the app', () => {
  assert.equal(indodaxTarget(request('/indodax-proxy/api/pairs'))?.href, 'https://indodax.com/api/pairs')
  assert.equal(indodaxTarget(request('/indodax-proxy/api/summaries'))?.href, 'https://indodax.com/api/summaries')
  assert.equal(indodaxTarget(request('/indodax-proxy/api/ticker/btcidr'))?.href, 'https://indodax.com/api/ticker/btcidr')
  assert.equal(indodaxTarget(request('/indodax-proxy/api/depth/ethidr'))?.href, 'https://indodax.com/api/depth/ethidr')
})

test('allows a well-formed bounded candle history request', () => {
  const from = now - 160 * 15 * 60
  const target = indodaxTarget(request(`/indodax-proxy/tradingview/history_v2?from=${from}&to=${now}&symbol=btcidr&tf=15`), now)
  assert.equal(target?.origin, 'https://indodax.com')
  assert.equal(target?.pathname, '/tradingview/history_v2')
  assert.equal(target?.searchParams.get('symbol'), 'btcidr')
})

test('rejects unsupported routes and extra query parameters', () => {
  assert.equal(indodaxTarget(request('/indodax-proxy/api/users')), null)
  assert.equal(indodaxTarget(request('/indodax-proxy/api/ticker/btcidr?foo=bar')), null)
  assert.equal(indodaxTarget(request('/indodax-proxy/api/depth/btcidr/extra')), null)
  assert.equal(indodaxTarget(request('/indodax-proxy/api/ticker/%2e%2e')), null)
})

test('rejects duplicate, malformed, future, or oversized history requests', () => {
  const from = now - 100 * 15 * 60
  const good = `/indodax-proxy/tradingview/history_v2?from=${from}&to=${now}&symbol=btcidr&tf=15`
  assert.equal(indodaxTarget(request(`${good}&tf=60`), now), null)
  assert.equal(indodaxTarget(request(`/indodax-proxy/tradingview/history_v2?from=${now}&to=${now - 1}&symbol=btcidr&tf=15`), now), null)
  assert.equal(indodaxTarget(request(`/indodax-proxy/tradingview/history_v2?from=${now - 400 * 15 * 60}&to=${now}&symbol=btcidr&tf=15`), now), null)
  assert.equal(indodaxTarget(request(`/indodax-proxy/tradingview/history_v2?from=${from}&to=${now + 61}&symbol=btcidr&tf=15`), now), null)
  assert.equal(indodaxTarget(request(`/indodax-proxy/tradingview/history_v2?from=${from}&to=${now}&symbol=btcidr&tf=1`), now), null)
})
