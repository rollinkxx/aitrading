# AITrading TODO

- [x] Live Indodax market data through official pairs, summaries, depth, server time, and OHLC history; reject stale/incomplete data and expose timestamps.
- [x] Multi-timeframe EMA trend, RSI/MACD momentum, ATR volatility, volume/spread filters, directional levels, confidence, and explanations.
- [x] Mobile dashboard with connection/freshness, selected market, price, score, discovery filters, and data-quality state.
- [x] Markets, Signals, Watchlist, Settings; local watchlist and server-backed signal history; opt-in browser notifications while open.
- [x] Supabase schema/RLS plus dedupe/outcome support; production collector is protected by a Vault-backed header verified with service role.
- [x] Background collector and public read-only snapshot endpoint deployed; existing Supabase Cron job is active every five minutes.
- [x] Add a separate one-minute signal checker for fresh summaries and unexpired active BUY/SELL levels; it avoids candle/depth calls, skips five-minute boundaries owned by the full collector, and does not persist every market ticker.
- [x] Deploy the checker and schedule it through the existing Vault-backed secret; recent pg_net responses show HTTP 200 with fresh ticker checks, while direct unauthenticated POST is rejected with 401. The full collector remains every five minutes.
- [x] Make outcome writes safe when the checker and full collector overlap: one outcome per signal, outcome persistence before closing, only fresh ticker prices, and no processing of expired signals.
- [x] Extend the full collector HTTP timeout to 30 seconds after observing repeated pg_net 5-second timeouts; the post-fix run returned HTTP 200 in 11 seconds.
- [x] Post-timeout-fix scheduled run completed at 11:45 UTC: 438 markets/ticks, 1,920 candle upserts, and 8 signals persisted; the dashboard snapshot refreshed successfully.
- [x] Production app released: commit `42e27f5` is on private GitHub `main`; Cloudflare Worker `aitrading-app` deployed the build at 12:02 UTC with 100% traffic.
- [x] Local responsive preview checked at 390×844 and 320×800; production index and hashed JS/CSS return HTTP 200, and headless Chromium renders a live Indodax price plus the completed collector status.
