create extension if not exists pgcrypto;

create table if not exists public.markets (
  id text primary key, symbol text not null, base_asset text not null, quote_asset text not null default 'idr', status text not null default 'active', source text not null default 'indodax-official', last_synced_at timestamptz
);
create table if not exists public.market_ticks (
  id uuid primary key default gen_random_uuid(), market_id text references public.markets(id) on delete cascade, last_price numeric not null, best_bid numeric, best_ask numeric, volume_24h numeric, high_24h numeric, low_24h numeric, source_timestamp timestamptz not null, received_at timestamptz not null default now(), data_status text not null default 'validated'
);
create table if not exists public.candles (
  id uuid primary key default gen_random_uuid(), market_id text references public.markets(id) on delete cascade, timeframe text not null, open_time timestamptz not null, close_time timestamptz not null, open numeric not null, high numeric not null, low numeric not null, close numeric not null, volume numeric not null default 0, is_closed boolean not null default true, source text not null default 'indodax-official', checksum text, unique(market_id,timeframe,open_time)
);
create table if not exists public.indicators (
  id uuid primary key default gen_random_uuid(), market_id text references public.markets(id) on delete cascade, timeframe text not null, candle_time timestamptz not null, ema_20 numeric, ema_50 numeric, ema_200 numeric, rsi numeric, macd numeric, macd_signal numeric, atr numeric, volume_ratio numeric, unique(market_id,timeframe,candle_time)
);
create table if not exists public.signals (
  id uuid primary key default gen_random_uuid(), market_id text references public.markets(id) on delete cascade, signal_type text not null check (signal_type in ('BUY','SELL','HOLD','WAIT')), timeframe text not null, confidence numeric not null check(confidence between 0 and 100), reference_price numeric, entry_low numeric, entry_high numeric, stop_loss numeric, take_profit numeric, risk_reward numeric, reason_codes jsonb not null default '[]', reason_text text not null, data_quality text not null, created_at timestamptz not null default now(), expires_at timestamptz, status text not null default 'active'
);
create table if not exists public.signal_outcomes (
  id uuid primary key default gen_random_uuid(), signal_id uuid references public.signals(id) on delete cascade, exit_price numeric, return_percentage numeric, max_favorable_excursion numeric, max_adverse_excursion numeric, outcome text, closed_at timestamptz
);
create table if not exists public.watchlists (
  user_id uuid references auth.users(id) on delete cascade, market_id text references public.markets(id) on delete cascade, created_at timestamptz not null default now(), primary key(user_id,market_id)
);
create table if not exists public.alert_rules (
  id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete cascade, market_id text references public.markets(id) on delete cascade, minimum_confidence numeric not null default 70, enabled boolean not null default true, alert_on_buy boolean not null default true, alert_on_sell boolean not null default true, alert_on_target boolean not null default true, alert_on_stop_loss boolean not null default true, unique(user_id,market_id)
);
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(), event_type text not null, source text not null, request_id text, payload_hash text, status text not null, error_code text, created_at timestamptz not null default now()
);

alter table public.markets enable row level security;
alter table public.market_ticks enable row level security;
alter table public.candles enable row level security;
alter table public.indicators enable row level security;
alter table public.signals enable row level security;
alter table public.signal_outcomes enable row level security;
alter table public.watchlists enable row level security;
alter table public.alert_rules enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists markets_public_read on public.markets; create policy markets_public_read on public.markets for select using (true);
drop policy if exists ticks_public_read on public.market_ticks; create policy ticks_public_read on public.market_ticks for select using (true);
drop policy if exists candles_public_read on public.candles; create policy candles_public_read on public.candles for select using (true);
drop policy if exists indicators_public_read on public.indicators; create policy indicators_public_read on public.indicators for select using (true);
drop policy if exists signals_public_read on public.signals; create policy signals_public_read on public.signals for select using (true);
drop policy if exists outcomes_public_read on public.signal_outcomes; create policy outcomes_public_read on public.signal_outcomes for select using (true);
drop policy if exists watchlists_owner_all on public.watchlists; create policy watchlists_owner_all on public.watchlists for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists alerts_owner_all on public.alert_rules; create policy alerts_owner_all on public.alert_rules for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists audit_no_public_write on public.audit_logs; create policy audit_no_public_write on public.audit_logs for select using (false);

create index if not exists candles_market_tf_time on public.candles(market_id,timeframe,open_time desc);
create index if not exists signals_market_created on public.signals(market_id,created_at desc);
