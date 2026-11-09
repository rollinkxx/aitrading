-- Operational query indexes and an opt-in, bounded retention primitive.
-- No rows are deleted and no cleanup schedule is created by this migration.

create index if not exists market_ticks_retention_idx
  on public.market_ticks (received_at);

create index if not exists signals_snapshot_idx
  on public.signals (created_at desc, id desc)
  where status in ('active', 'informational');

create index if not exists collector_runs_status_started_idx
  on public.collector_runs (status, started_at desc);

create or replace function public.prune_old_market_ticks(
  p_before timestamptz default now() - interval '14 days',
  p_batch_size integer default 5000
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_count integer := 0;
begin
  if p_before is null or p_before > now() - interval '14 days'
     or p_batch_size is null or p_batch_size < 1 or p_batch_size > 10000 then
    raise exception 'invalid market tick retention parameters';
  end if;

  with victims as (
    select ctid
      from public.market_ticks
     where received_at < p_before
     order by received_at
     limit p_batch_size
     for update skip locked
  )
  delete from public.market_ticks as ticks
   using victims
   where ticks.ctid = victims.ctid;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.prune_old_market_ticks(timestamptz, integer) from public, anon, authenticated;
grant execute on function public.prune_old_market_ticks(timestamptz, integer) to service_role;
