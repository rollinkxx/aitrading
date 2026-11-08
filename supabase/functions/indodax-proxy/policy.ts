const MARKET_ID = /^[a-z0-9_]{3,32}$/
const HISTORY_TIMEFRAMES = new Map([['15', 15 * 60], ['60', 60 * 60], ['240', 240 * 60]])

export function indodaxTarget(incoming: URL, nowSeconds = Math.floor(Date.now() / 1000)): URL | null {
  const apiPath = incoming.pathname.replace(/^\/indodax-proxy/, '') || '/'
  const params = incoming.searchParams
  let allowed = false

  if (apiPath === '/api/pairs' || apiPath === '/api/summaries') {
    allowed = [...params.keys()].length === 0
  } else {
    const marketRoute = apiPath.match(/^\/api\/(ticker|depth)\/([a-z0-9_]{3,32})$/)
    if (marketRoute && MARKET_ID.test(marketRoute[2])) {
      allowed = [...params.keys()].length === 0
    } else if (apiPath === '/tradingview/history_v2') {
      const keys = [...params.keys()]
      const unique = new Set(keys)
      const tf = params.get('tf') || ''
      const intervalSeconds = HISTORY_TIMEFRAMES.get(tf)
      const from = Number(params.get('from'))
      const to = Number(params.get('to'))
      const symbol = params.get('symbol') || ''
      allowed = keys.length === 4
        && unique.size === 4
        && ['from', 'to', 'symbol', 'tf'].every(key => unique.has(key))
        && intervalSeconds !== undefined
        && MARKET_ID.test(symbol)
        && Number.isSafeInteger(from)
        && Number.isSafeInteger(to)
        && from > 0
        && to > from
        && to <= nowSeconds + 60
        && to - from <= intervalSeconds * 300
    }
  }

  if (!allowed) return null
  const target = new URL(`https://indodax.com${apiPath}`)
  target.search = incoming.search
  return target
}
