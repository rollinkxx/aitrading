-- Background collector run ledger.
-- This migration is already recorded as applied in the AITrading production
-- migration ledger; keep this source in sync so fresh environments are
-- reproducible. Detailed errors are private operational data.
create table if not exists public.collector_runs (
  id uuid primary key default gen_random_uuid(),
  run_key text not null unique,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed', 'skipped')),
  markets_count integer not null default 0,
  ticks_count integer not null default 0,
  candles_count integer not null default 0,
  signals_count integer not null default 0,
  outcomes_count integer not null default 0,
  error_message text
);

alter table public.collector_runs enable row level security;
revoke all on table public.collector_runs from public, anon, authenticated;
grant all on table public.collector_runs to service_role;
