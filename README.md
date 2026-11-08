# AITrading

Mobile-first Indodax signal engine using official public market data. This release is **signal-only**: it does not connect to private account APIs and never submits orders.

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

If Supabase variables are not configured, the dashboard still runs with live Indodax data and local watchlist persistence.

## Background collector

Supabase Edge Function `market-collector` is called by the full `pg_cron` job every five minutes with a 30-second HTTP timeout. It snapshots public Indodax IDR markets and tickers, fetches 15m/1h/4h candles for the eight highest-volume eligible markets, and records indicators and deduplicated signals. A separate `signal-checker` job runs once per minute. It fetches one official summaries response only when unexpired BUY/SELL signals exist, rejects stale tickers, and records target/stop outcomes idempotently before closing matched signals. The two functions share that persistence path and rely on a unique `signal_id` outcome index, so overlapping runs converge without duplicate outcomes. The checker does not fetch candles/depth or store a new tick row for every market. On five-minute boundaries it delegates to the full collector. Both functions verify the Vault-held cron secret through a service-role-only database RPC; the secret is not part of the frontend or repository. The collector GET endpoint returns public market snapshots, signals, and full-collector status.

Outcome recording uses observed ticker prices, so short-lived price crossings between one-minute samples may still be missed. Background signals cover the top eight markets by IDR volume; the open dashboard can analyze a selected market live. Browser alerts are opt-in and only run while the page is open; no push notifications or automatic order placement are enabled.

The displayed 0–100 signal score is a **heuristic ranking**, not a calibrated probability of profit or a claim of strategy accuracy. Stored stop/target outcomes are snapshot-sampled from observed ticker prices; they are not a full intrabar execution simulation and do not include fees or slippage.

When configuring another environment, apply the migrations under `supabase/migrations`, create a high-entropy secret named `collector_shared_secret` in Vault, then configure the five-minute full-collector job and one-minute signal-checker job to send the Vault value as `x-collector-secret`. Never commit the secret value.

## Official data sources

- `https://indodax.com/api/pairs`
- `https://indodax.com/api/summaries`
- `https://indodax.com/api/depth/{pair}`
- `https://indodax.com/tradingview/history_v2?from=...&to=...&symbol=...&tf=...`

## Safety

Signals are analytical outputs, not financial advice or profit guarantees. The engine returns WAIT when data is stale, incomplete, or liquidity checks fail. Auto-trading is intentionally not implemented.

## Verification

```bash
npm ci
npm run test
npm run build
```
