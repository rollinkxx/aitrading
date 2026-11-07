alter table public.signals add column if not exists dedupe_key text;
create unique index if not exists signals_dedupe_key_unique on public.signals(dedupe_key) where dedupe_key is not null;
create index if not exists market_ticks_market_received on public.market_ticks(market_id, received_at desc);
create index if not exists market_ticks_received on public.market_ticks(received_at desc);
create index if not exists signals_active_created on public.signals(created_at desc) where status = 'active';
create index if not exists collector_runs_started on public.collector_runs(started_at desc);

create or replace function public.verify_collector_secret(provided_secret text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select coalesce(bool_or(decrypted_secret = provided_secret), false)
  from vault.decrypted_secrets
  where name = 'collector_shared_secret';
$$;

revoke all on function public.verify_collector_secret(text) from public, anon, authenticated;
grant execute on function public.verify_collector_secret(text) to service_role;
