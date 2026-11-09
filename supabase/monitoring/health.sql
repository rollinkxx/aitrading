-- Run as an authorized Supabase operator. These statements are read-only.
select jsonb_build_object(
  'checked_at', now(),
  'latest_tick', (select to_jsonb(t) from (
    select received_at, source_timestamp, data_status, market_id
      from public.market_ticks order by received_at desc limit 1
  ) t),
  'latest_completed_run', (select to_jsonb(r) from (
    select started_at, finished_at, status, markets_count, ticks_count, candles_count, signals_count
      from public.collector_runs where status = 'completed'
     order by finished_at desc limit 1
  ) r),
  'recent_run_counts', (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from (
    select status, count(*) as runs, max(started_at) as newest
      from public.collector_runs
     where started_at >= now() - interval '24 hours'
     group by status order by status limit 5
  ) r),
  'market_tick_rows', (select count(*) from public.market_ticks)
) as health
limit 1;

select jobname, schedule, active
  from cron.job
 where jobname in ('aitrading-active-signal-checker', 'aitrading-market-collector')
 order by jobname
 limit 5;

select schemaname, relname, pg_size_pretty(pg_total_relation_size(format('%I.%I', schemaname, relname)::regclass)) as total_size
  from pg_stat_user_tables
 where schemaname = 'public'
   and relname in ('market_ticks', 'signals', 'candles', 'collector_runs')
 order by pg_total_relation_size(format('%I.%I', schemaname, relname)::regclass) desc
 limit 5;
