# Monitoring and alert policy

Configure notifications in the Supabase/Cloudflare observability surfaces or an external uptime monitor. Never include Vault values, service-role keys, or request authorization headers in alert payloads.

- **Collector stalled:** alert when the newest `completed` run is older than 10 minutes, or two of the last six runs are `failed`. Check active pg_cron state, `cron.job_run_details`, `market-collector` function logs, and the run ledger. Do not increase the schedule frequency as a first response.
- **Ticker snapshot stale:** alert when the newest validated `market_ticks.received_at` is older than 10 minutes. Compare it with `source_timestamp`; investigate Indodax response age, collector duration, and database write failures.
- **Checker inactive:** alert if `aitrading-active-signal-checker` is missing/inactive or has no successful run for three minutes. Inspect `signal-checker` logs and ensure the Vault-backed secret is present; do not print the secret.
- **Snapshot endpoint errors:** page only for sustained 5xx (≥1% for 5 minutes); investigate function logs and query latency. The public GET is read-only and must not expose service credentials.
- **Storage growth:** review `market_ticks` row count and table/index bytes weekly. If it exceeds the retention budget, use the bounded `prune_old_market_ticks` procedure in a maintenance window; it is not scheduled automatically.
- **Worker errors:** alert on sustained elevated Cloudflare Worker error rate or failed asset responses. Use invocation logs/traces; keep sampling appropriate to traffic and avoid logging user secrets.

For a first response use `docs/ops/runbook.md` and the bounded queries in `supabase/monitoring/health.sql`. Preserve the latest failed run and function error context before manual retries.
