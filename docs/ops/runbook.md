# AITrading operations runbook

## Safety and scope

AITrading is signal-only: it has no exchange account credentials and cannot place orders. Do not add trading endpoints or private exchange keys as an incident workaround. Scores are heuristic, and outcomes are snapshot-sampled.

## Provisioning a new environment

1. Create the Supabase project and set the runtime `supabase_url` plus a high-entropy `collector_shared_secret` in Vault before enabling scheduled work. Never place either secret in Git, browser configuration, CI variables, or logs.
2. Apply migrations in timestamp order. If `supabase_url` or the collector secret is absent, the forward guard migration leaves both AITrading cron jobs disabled and emits a database warning instead of creating broken jobs.
3. After the prerequisites are present, invoke `select public.configure_aitrading_cron();` as an authorized service-role/database operator. Verify exactly one active checker (`* * * * *`) and one active full collector (`*/5 * * * *`) in `cron.job`.
4. Deploy the `market-collector` and `signal-checker` Edge Functions. Collector writes are fenced and committed atomically by `persist_collector_batch`; direct unauthenticated POST must remain rejected.
5. Run `supabase/monitoring/health.sql`, a GET to the public app and read-only snapshot endpoint, and check for a recent completed collector run. Do not run an exchange order test.

## Release sequence

1. Use a disposable local PostgreSQL database for `npm run test:integration`; the harness refuses remote hosts and requires `AITRADING_ALLOW_DATABASE_RESET=1` because it resets its test schemas.
2. Run `npm run verify:release` with Chromium, `psql`, and the disposable database available. Review the final diff and confirm no credentials are staged.
3. Merge only after GitHub CI is green. Preview builds must use `npx wrangler preview --config cloudflare/wrangler.jsonc`; production deploys are separate from preview.
4. For the Supabase runtime rollout, apply additive migrations first, then deploy `market-collector` with its shared helper files. Existing Edge Function code continues to work while the additive schema is present, so a failed function deploy can be rolled back to its prior function version without dropping the new schema.
5. Verify one newly completed run, a fresh tick, GET snapshot HTTP 200, unauthenticated POST HTTP 401, and a checker success before closing the release.

## Incident triage

- **Stale persisted data:** check the latest completed run and tick source/receive times. If a lease is `running` after expiry, preserve the row for diagnosis; the next claim should reclaim it and increment the fencing token. Do not manually write business tables.
- **Collector failures/timeouts:** compare total handler duration with the 25-second upstream deadline and 30-second pg_net timeout. Inspect sanitized function errors, Indodax availability, and database RPC latency. Do not run parallel full collectors.
- **Cron missing or disabled:** verify Vault secret existence without selecting or logging its value, then check `app.settings.supabase_url`. After correcting both, call `public.configure_aitrading_cron()` and confirm only two active AITrading jobs.
- **Snapshot 503:** inspect the Edge Function logs and latest tick/read-query health. The snapshot reads a bounded recent active/informational signal set and should not depend on all historical signals.
- **Rollback:** redeploy the previously working Edge Function version if a new handler fails. Keep additive SQL in place; do not drop the RPCs or constraints while an older function may be serving requests. Revert the app Worker separately only if its public GET fails.

## Market tick retention (manual, bounded)

The migration creates no cleanup job. Preview the candidate count before deletion:

```sql
select count(*) as rows_older_than_14_days
  from public.market_ticks
 where received_at < now() - interval '14 days'
 limit 1;
```

After confirming the cutoff and backup/retention policy, call the service-role-only function in a maintenance window. Each call removes at most 5,000 rows older than the 14-day minimum; repeat only while monitoring database load:

```sql
select public.prune_old_market_ticks(now() - interval '14 days', 5000);
```

Do not prune candles, signals, or outcomes with this function. Recheck latest ticker freshness after cleanup; the newest row for a market is retained unless data for that market has been absent for more than 14 days.
