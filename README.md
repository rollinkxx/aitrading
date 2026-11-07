# AITrading

Mobile-first Indodax signal engine using official public market data. This release is **signal-only**: it does not connect to private account APIs and never submits orders.

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

If Supabase variables are not configured, the dashboard still runs with live Indodax data and local watchlist persistence.

## Official data sources

- `https://indodax.com/api/pairs`
- `https://indodax.com/api/summaries`
- `https://indodax.com/api/depth/{pair}`
- `https://indodax.com/tradingview/history_v2?from=...&to=...&symbol=...&tf=...`

## Safety

Signals are analytical outputs, not financial advice or profit guarantees. The engine returns WAIT when data is stale, incomplete, or liquidity checks fail. Auto-trading is intentionally not implemented.
