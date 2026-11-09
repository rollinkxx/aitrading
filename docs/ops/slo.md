# AITrading operational SLOs

These are internal operating targets, not guarantees from Indodax, Supabase, or Cloudflare. Measure them weekly and review after any material change to schedules, traffic, or retention.

| Signal | Target | Alert threshold | Measurement |
|---|---:|---:|---|
| Public app availability | 99.5% per rolling 30 days | 3 consecutive failed probes or monthly error budget below 50% | Cloudflare Worker request/error analytics and external HTTP probe |
| Latest persisted ticker freshness | p95 age ≤ 7 minutes; maximum ≤ 10 minutes | latest validated tick older than 10 minutes | `supabase/monitoring/health.sql` |
| Full collector completion | at least 99% of 5-minute windows per rolling 24 hours | no completed run in 10 minutes, or 2 failed runs in 30 minutes | `collector_runs` and `cron.job_run_details` |
| Collector duration | p95 ≤ 20 seconds; hard upstream budget 25 seconds | any run > 25 seconds or increasing p95 | run ledger timestamps and function logs |
| Active signal checker | at least 99% of minute windows per rolling 24 hours | no checker success for 3 minutes or missing/inactive cron job | pg_cron run details and Edge Function logs |
| Snapshot endpoint | p95 ≤ 2 seconds and error rate < 1% | 5xx rate ≥ 1% over 5 minutes | Supabase Edge logs and browser/API probe |

The browser uses current public Indodax data for the selected market. The persisted market snapshot is a separate background product and may be several minutes behind between collector runs; the UI must label freshness rather than silently presenting stale values as live.

Signals remain analytical and signal-only. The 0–100 score is a heuristic ranking, not a calibrated probability, performance guarantee, or instruction to trade. There is no order execution. Outcome records use `snapshot_sampled` observations and can miss price crossings between checks; they do not model fees, slippage, or intrabar execution.
