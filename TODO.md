# AITrading TODO

- [ ] Live Indodax market data: use official pairs, summaries, depth, server time, and OHLC history; reject stale or incomplete data and label source timestamps.
- [ ] Professional signal engine: multi-timeframe EMA trend, RSI/MACD momentum, ATR volatility, volume and spread/liquidity filters; produce BUY/SELL/HOLD/WAIT with confidence, entry zone, stop-loss, target, risk/reward, and explanation.
- [ ] Mobile dashboard: show connection status, freshness, selected market, current price, signal score, market cards, and clear data-quality state.
- [ ] Markets, Signals, Watchlist, Settings navigation with persistent local watchlist and signal history.
- [ ] Supabase production schema: markets, market_ticks, candles, indicators, signals, signal_outcomes, watchlists, alert_rules, audit_logs with RLS.
- [ ] Cloudflare hosting: production build deployable from the connected repository with a secure static configuration and no trading credentials.
- [ ] Validation: typecheck, production build, live endpoint smoke tests, and mobile layout review.
