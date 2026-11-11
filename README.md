# AITrading

Mobile-first Indodax signal engine using official public market data, plus an isolated paper-trading simulator. The application never connects to private account APIs and never submits live orders.

## Run

```bash
node --version # 22.6+
npm ci
cp .env.example .env
npm run dev
```

If Supabase variables are not configured, the dashboard still runs with live Indodax data and local watchlist persistence. Paper status/history requires the separate paper-project variables below.

## Paper trading

The shared paper portfolio starts at Rp100.000.000 and runs in the isolated `aitrading-paper` Supabase project. It accepts only fresh, validated BUY entries, models CFX at 0,00555% per side, limits each position to 10% of equity, and blocks new entries after a 2% daily drawdown while continuing to manage exits. Closed trades are classified as MENANG, KALAH, or IMPAS from net realized P&L; open positions are not counted in history.

The Dashboard shows equity and open positions, Signals shows the win/loss ledger, and Settings exposes the intentionally unauthenticated shared pair/pause/resume/stop controls. These controls affect only the paper portfolio and are recorded in its audit log. Add these browser-safe values to `.env` when running the paper UI locally:

```bash
VITE_PAPER_SUPABASE_URL=https://your-paper-project.supabase.co
VITE_PAPER_SUPABASE_ANON_KEY=your-paper-publishable-key
```

## Background collector

Supabase Edge Function `market-collector` is called by the full `pg_cron` job every five minutes with a 30-second HTTP timeout. The handler enforces a 25-second total upstream deadline, leaving headroom to persist the run result before `pg_net` expires. It snapshots public Indodax IDR markets and tickers, fetches 15m/1h/4h candles for the eight highest-volume eligible markets, and records indicators and deduplicated signals. A separate `signal-checker` job runs once per minute. It fetches one official summaries response only when unexpired BUY/SELL signals exist, rejects stale tickers, and records target/stop outcomes idempotently before closing matched signals. The two functions share that persistence path and rely on a unique `signal_id` outcome index, so overlapping runs converge without duplicate outcomes. The checker does not fetch candles/depth or store a new tick row for every market. On five-minute boundaries it delegates to the full collector. Both functions verify the Vault-held cron secret through a service-role-only database RPC; the secret is not part of the frontend or repository. The collector GET endpoint returns public market snapshots, signals, and full-collector status.

Outcome recording uses observed ticker prices, so short-lived price crossings between one-minute samples may still be missed. Background signals cover the top eight markets by IDR volume; the open dashboard can analyze a selected market live. Browser alerts are opt-in and only run while the page is open; no push notifications or automatic order placement are enabled.

The displayed 0–100 signal score is a **heuristic ranking**, not a calibrated probability of profit or a claim of strategy accuracy. Stored stop/target outcomes are snapshot-sampled from observed ticker prices; they are not a full intrabar execution simulation and do not include fees or slippage.

For a new environment, set `supabase_url` and a high-entropy `collector_shared_secret` in Supabase Vault **before** enabling cron. Apply migrations in timestamp order. The forward guard disables both AITrading jobs when URL/secret prerequisites are missing; after provisioning, an authorized operator can call `select public.configure_aitrading_cron();` to configure exactly one checker (`* * * * *`) and one full collector (`*/5 * * * *`). The secret is read from Vault at run time and must never be committed or logged.

## Official data sources

- `https://indodax.com/api/pairs`
- `https://indodax.com/api/summaries`
- `https://indodax.com/api/depth/{pair}`
- `https://indodax.com/tradingview/history_v2?from=...&to=...&symbol=...&tf=...`

## Safety

Signals are analytical outputs, not financial advice or profit guarantees. The engine returns WAIT when data is stale, incomplete, or liquidity checks fail. Auto-trading is paper-only: no exchange credentials, private endpoints, or live order path exists.

## Verification

```bash
npm ci
npm test
npm run typecheck
npm run build
npm audit --omit=dev
npm run test:e2e
DATABASE_URL=postgres://postgres:postgres@localhost:5432/aitrading_test \
  AITRADING_ALLOW_DATABASE_RESET=1 npm run test:integration
```

The integration harness rejects non-local database hosts and requires an explicit disposable-database opt-in. `npm run verify:release` runs the full local gate, including migration replay, Chromium smoke, and Wrangler dry-run; it does not deploy. See [SLOs](docs/ops/slo.md), [alerts](docs/ops/alerts.md), the [operations runbook](docs/ops/runbook.md), and [read-only health queries](supabase/monitoring/health.sql).
