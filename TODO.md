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
- [x] Forensic audit completed across UI, market-data adapter, signal strategy, Supabase functions, migrations/RLS, Worker configuration, and tests; see `artifacts/audit-forensik-2026-11-09.md`.
- [x] Reconstructed missing historical `20261107090437_background_collector.sql` from production schema and call sites; migration source now defines the run ledger, RLS, and service-role-only access.
- [x] Hardened local storage fallback/validation, directory response ordering, market-data timeout/retry/depth validation, proxy streaming byte limit, heuristic-score wording, and neutral RSI for flat prices.
- [x] Regression suite now passes 39/39; typecheck, production build, Wrangler dry-run, local browser navigation/search smoke test, and npm audits pass.
- [x] Add atomic retry/reclaim for failed or stale collector runs with a database lease, heartbeat timestamp, fencing token, guarded completion, and concurrent-claim regression coverage.
- [x] Add migration replay against a clean disposable PostgreSQL database and integration coverage for collector auth, failures, and browser refresh races; the release gate replays all standard migrations locally with fenced-lease assertions.
- [x] Replace hardcoded Supabase function URLs in portable cron setup; migration fails closed without a runtime URL/Vault value and production has exactly one active job per name.
- [x] Add bounded snapshot pagination before market/signal count approaches the previous 1,000/500-row limits; the endpoint now fails closed above its configured maximum instead of silently truncating.
- [x] Keep outcome reporting explicitly labeled as `snapshot_sampled`; candle-range evaluation and out-of-sample calibration remain intentionally open before any probability/accuracy claims.

- [x] Add isolated shared-balance paper auto-trading schema, private win/loss ledger, public status/history RPCs, unauthenticated global controls with audit trail, and service-role-only atomic tick RPCs in the separate `aitrading-paper` Supabase project; no live orders or credentials.
- [x] Deploy the paper-only Edge Function with official public Indodax ticker/depth/OHLC data, CFX modeled at 0.00555% per side, bounded quotes, stop/take-profit monitoring, daily 2% loss guard, 10% position cap, and a lease/fencing token.
- [x] Schedule `paper-engine` every minute through a Vault-backed secret on the separate paper database; keep paper migrations/functions outside default production Supabase directories.
- [x] Add frontend paper status, shared portfolio, open positions, full-history win/loss/breakeven aggregate, latest 50 trade cards, and pair/pause/resume/stop controls; deploy the verified UI bundle to the production Worker.
- [x] Verify scheduled paper ticks, successful HTTP 200 responses, rendered Preview smoke marker, anonymous public-safe stats/history reads, and no trade before an eligible fresh BUY arrives.
