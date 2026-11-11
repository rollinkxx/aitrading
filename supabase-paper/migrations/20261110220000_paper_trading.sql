-- Isolated paper-trading schema. Apply only to Supabase project xkhsxjyleqnhuptesepg.
-- No live exchange credentials, order placement, or production-project references.

create table public.paper_config (
  id smallint primary key check (id = 1),
  initial_balance numeric(30, 10) not null check (initial_balance > 0),
  active_pair text not null check (active_pair ~ '^[a-z0-9]{2,20}idr$'),
  bot_status text not null check (bot_status in ('active', 'paused', 'stopped')),
  position_size_pct numeric(8, 6) not null check (position_size_pct > 0 and position_size_pct <= 0.10),
  daily_loss_limit_pct numeric(8, 6) not null check (daily_loss_limit_pct > 0 and daily_loss_limit_pct <= 0.02),
  cfx_fee_rate numeric(12, 10) not null check (cfx_fee_rate = 0.0000555),
  trigger_secret_hash bytea not null,
  updated_at timestamptz not null default now()
);

create table public.paper_portfolio (
  id smallint primary key check (id = 1),
  cash_balance numeric(30, 10) not null check (cash_balance >= 0),
  daily_date date not null,
  daily_start_equity numeric(30, 10) not null check (daily_start_equity > 0),
  daily_loss_locked boolean not null default false,
  realized_pnl numeric(30, 10) not null default 0,
  last_tick_at timestamptz,
  run_lock_token uuid,
  run_lease_until timestamptz,
  updated_at timestamptz not null default now()
);

create table public.paper_positions (
  market_id text primary key check (market_id ~ '^[a-z0-9]{2,20}idr$'),
  signal_id text not null,
  quantity numeric(30, 14) not null check (quantity > 0),
  entry_price numeric(30, 10) not null check (entry_price > 0),
  entry_notional numeric(30, 10) not null check (entry_notional > 0),
  entry_fee numeric(30, 10) not null check (entry_fee >= 0),
  stop_loss numeric(30, 10) not null check (stop_loss > 0),
  take_profit numeric(30, 10) not null check (take_profit > 0),
  mark_price numeric(30, 10) not null check (mark_price > 0),
  opened_at timestamptz not null,
  entry_source_at timestamptz not null,
  mark_updated_at timestamptz not null,
  entry_event_key text not null unique
);

create table public.paper_events (
  event_key text primary key,
  market_id text not null,
  signal_id text not null,
  event_action text not null check (event_action in ('open', 'close')),
  reason text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.paper_control_events (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('pair', 'pause', 'resume', 'stop')),
  previous_value text,
  new_value text not null,
  created_at timestamptz not null default now()
);

create table public.paper_trades (
  id uuid primary key default gen_random_uuid(),
  market_id text not null,
  entry_signal_id text not null,
  exit_signal_id text not null,
  entry_price numeric(30, 10) not null,
  exit_price numeric(30, 10) not null,
  quantity numeric(30, 14) not null,
  entry_notional numeric(30, 10) not null,
  exit_notional numeric(30, 10) not null,
  entry_fee numeric(30, 10) not null,
  exit_fee numeric(30, 10) not null,
  realized_net_pnl numeric(30, 10) not null,
  outcome text not null check (outcome in ('win', 'loss', 'breakeven')),
  close_reason text not null check (close_reason in ('signal_sell', 'stop_loss', 'take_profit')),
  price_source text not null default 'indodax_public_api' check (price_source = 'indodax_public_api'),
  entry_at timestamptz not null,
  exit_at timestamptz not null,
  entry_source_at timestamptz not null,
  exit_source_at timestamptz not null,
  close_event_key text not null unique
);

create index paper_trades_exit_at_desc on public.paper_trades (exit_at desc, id desc);
create index paper_events_market_created on public.paper_events (market_id, created_at desc);

insert into public.paper_config (
  id, initial_balance, active_pair, bot_status, position_size_pct,
  daily_loss_limit_pct, cfx_fee_rate, trigger_secret_hash
) values (1, 100000000, 'btcidr', 'active', 0.10, 0.02, 0.0000555, decode(repeat('00', 32), 'hex'));

insert into public.paper_portfolio (id, cash_balance, daily_date, daily_start_equity)
values (1, 100000000, timezone('Asia/Jakarta', now())::date, 100000000);

do $$
declare
  v_trigger_secret text;
begin
  v_trigger_secret := encode(extensions.gen_random_bytes(32), 'hex');
  perform vault.create_secret(v_trigger_secret, 'paper_engine_trigger', 'Private trigger secret for the paper-only scheduled Edge Function');
  update public.paper_config
  set trigger_secret_hash = extensions.digest(v_trigger_secret, 'sha256'), updated_at = now()
  where id = 1;
end;
$$;

alter table public.paper_config enable row level security;
alter table public.paper_portfolio enable row level security;
alter table public.paper_positions enable row level security;
alter table public.paper_events enable row level security;
alter table public.paper_control_events enable row level security;
alter table public.paper_trades enable row level security;

revoke all on table public.paper_config, public.paper_portfolio, public.paper_positions, public.paper_events, public.paper_control_events, public.paper_trades from public, anon, authenticated;
grant all on table public.paper_config, public.paper_portfolio, public.paper_positions, public.paper_events, public.paper_control_events, public.paper_trades to service_role;

create or replace function public.verify_paper_trigger_secret(p_presented_secret text)
returns boolean
language sql
security definer
set search_path = pg_catalog, public, extensions
as $$
  select p_presented_secret is not null
    and length(p_presented_secret) >= 32
    and extensions.digest(p_presented_secret, 'sha256') = c.trigger_secret_hash
  from public.paper_config c
  where c.id = 1;
$$;
revoke all on function public.verify_paper_trigger_secret(text) from public, anon, authenticated;
grant execute on function public.verify_paper_trigger_secret(text) to service_role;

create or replace function public.claim_paper_run(p_run_token uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_claimed boolean := false;
begin
  if p_run_token is null then return false; end if;
  update public.paper_portfolio
    set run_lock_token = p_run_token,
        run_lease_until = now() + interval '90 seconds',
        updated_at = now()
  where id = 1 and (run_lease_until is null or run_lease_until <= now())
  returning true into v_claimed;
  return coalesce(v_claimed, false);
end;
$$;
revoke all on function public.claim_paper_run(uuid) from public, anon, authenticated;
grant execute on function public.claim_paper_run(uuid) to service_role;

create or replace function public.release_paper_run(p_run_token uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_released boolean := false;
begin
  update public.paper_portfolio
    set run_lock_token = null, run_lease_until = null, updated_at = now()
  where id = 1 and run_lock_token = p_run_token
  returning true into v_released;
  return coalesce(v_released, false);
end;
$$;
revoke all on function public.release_paper_run(uuid) from public, anon, authenticated;
grant execute on function public.release_paper_run(uuid) to service_role;

create or replace function public.get_paper_public_state()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with account as (
    select
      c.initial_balance,
      c.active_pair,
      c.bot_status,
      c.position_size_pct,
      c.daily_loss_limit_pct,
      c.cfx_fee_rate,
      p.cash_balance,
      p.daily_date,
      p.daily_start_equity,
      p.daily_loss_locked,
      p.realized_pnl,
      p.last_tick_at,
      p.updated_at,
      p.cash_balance + coalesce((select sum(pos.quantity * pos.mark_price) from public.paper_positions pos), 0) as equity
    from public.paper_config c
    join public.paper_portfolio p on p.id = c.id
    where c.id = 1
  )
  select to_jsonb(a) || jsonb_build_object(
    'daily_pnl', a.equity - a.daily_start_equity,
    'daily_loss_amount', greatest(0, a.daily_start_equity - a.equity),
    'daily_loss_limit_amount', a.daily_start_equity * a.daily_loss_limit_pct,
    'unrealized_pnl', a.equity - a.cash_balance - coalesce((select sum(pos.entry_notional + pos.entry_fee) from public.paper_positions pos), 0),
    'open_positions', coalesce((
      select jsonb_agg(to_jsonb(pos) order by pos.market_id)
      from public.paper_positions pos
    ), '[]'::jsonb)
  )
  from account a;
$$;
revoke all on function public.get_paper_public_state() from public;
grant execute on function public.get_paper_public_state() to anon, authenticated;

create or replace view public.paper_public_history as
select
  id, market_id, entry_signal_id, exit_signal_id, entry_price, exit_price,
  quantity, entry_notional, exit_notional, entry_fee, exit_fee, realized_net_pnl,
  outcome, close_reason, price_source, entry_at, exit_at, entry_source_at, exit_source_at
from public.paper_trades;
revoke all on public.paper_public_history from public;
grant select on public.paper_public_history to anon, authenticated;

create or replace function public.get_paper_public_stats()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'closed_trades', count(*),
    'wins', count(*) filter (where outcome = 'win'),
    'losses', count(*) filter (where outcome = 'loss'),
    'breakeven', count(*) filter (where outcome = 'breakeven'),
    'realized_net_pnl', coalesce(sum(realized_net_pnl), 0),
    'fees_total', coalesce(sum(entry_fee + exit_fee), 0)
  )
  from public.paper_trades;
$$;
revoke all on function public.get_paper_public_stats() from public;
grant execute on function public.get_paper_public_stats() to anon, authenticated;

create or replace function public.set_paper_control(p_action text, p_value text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_status text;
  v_old_value text;
  v_new_value text;
begin
  if p_action = 'pair' then
    if p_value is null or p_value !~ '^[a-z0-9]{2,20}idr$' then
      raise exception 'invalid IDR market pair';
    end if;
    select active_pair into v_old_value from public.paper_config where id = 1 for update;
    update public.paper_config set active_pair = p_value, updated_at = now() where id = 1;
    v_new_value := p_value;
  elsif p_action in ('pause', 'resume', 'stop') then
    select bot_status into v_old_value from public.paper_config where id = 1 for update;
    v_status := case p_action when 'pause' then 'paused' when 'stop' then 'stopped' else 'active' end;
    update public.paper_config set bot_status = v_status, updated_at = now() where id = 1;
    v_new_value := v_status;
  else
    raise exception 'unsupported paper control action';
  end if;
  insert into public.paper_control_events(action, previous_value, new_value)
  values (p_action, v_old_value, v_new_value);
  return public.get_paper_public_state();
end;
$$;
revoke all on function public.set_paper_control(text, text) from public;
grant execute on function public.set_paper_control(text, text) to anon, authenticated;

create or replace function public.process_paper_tick(p_run_token uuid, p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  v_config public.paper_config%rowtype;
  v_portfolio public.paper_portfolio%rowtype;
  v_market text;
  v_signal_id text;
  v_signal_type text;
  v_quality text;
  v_source_at timestamptz;
  v_expires_at timestamptz;
  v_bid numeric;
  v_ask numeric;
  v_last numeric;
  v_entry_low numeric;
  v_entry_high numeric;
  v_stop numeric;
  v_target numeric;
  v_position public.paper_positions%rowtype;
  v_has_position boolean := false;
  v_equity numeric;
  v_notional numeric;
  v_fee numeric;
  v_quantity numeric;
  v_exit_notional numeric;
  v_exit_fee numeric;
  v_pnl numeric;
  v_reason text;
  v_outcome text;
  v_event_key text;
  v_local_date date;
begin
  if jsonb_typeof(p_event) <> 'object' then raise exception 'invalid paper tick'; end if;
  v_market := lower(p_event->>'market_id');
  v_signal_id := coalesce(p_event->>'signal_id', '');
  v_signal_type := upper(coalesce(p_event->>'signal_type', 'WAIT'));
  v_quality := coalesce(p_event->>'quality', 'insufficient');
  v_bid := nullif(p_event->>'bid', '')::numeric;
  v_ask := nullif(p_event->>'ask', '')::numeric;
  v_last := nullif(p_event->>'last', '')::numeric;
  v_entry_low := nullif(p_event->>'entry_low', '')::numeric;
  v_entry_high := nullif(p_event->>'entry_high', '')::numeric;
  v_stop := nullif(p_event->>'stop_loss', '')::numeric;
  v_target := nullif(p_event->>'take_profit', '')::numeric;
  v_source_at := nullif(p_event->>'source_at', '')::timestamptz;
  v_expires_at := nullif(p_event->>'expires_at', '')::timestamptz;

  if v_market is null or v_market !~ '^[a-z0-9]{2,20}idr$'
     or v_signal_id = ''
     or v_bid is null or v_ask is null or v_last is null
     or v_bid <= 0 or v_ask < v_bid or v_last <= 0
     or v_source_at is null
     or v_source_at < now() - interval '120 seconds'
     or v_source_at > now() + interval '60 seconds' then
    return jsonb_build_object('status', 'rejected', 'reason', 'stale_or_invalid_market_data');
  end if;

  select * into v_config from public.paper_config where id = 1 for update;
  select * into v_portfolio from public.paper_portfolio where id = 1 for update;
  if v_config.id is null or v_portfolio.id is null then raise exception 'paper account not initialized'; end if;
  if v_portfolio.run_lock_token is distinct from p_run_token
     or v_portfolio.run_lease_until is null
     or v_portfolio.run_lease_until <= now() then
    return jsonb_build_object('status', 'stale_or_unclaimed_run');
  end if;
  update public.paper_portfolio set last_tick_at = now(), updated_at = now() where id = 1;
  v_portfolio.last_tick_at := now();

  v_local_date := timezone('Asia/Jakarta', now())::date;
  if v_portfolio.daily_date <> v_local_date then
    select v_portfolio.cash_balance + coalesce(sum(quantity * mark_price), 0) into v_equity
    from public.paper_positions;
    update public.paper_portfolio
      set daily_date = v_local_date,
          daily_start_equity = coalesce(v_equity, v_portfolio.cash_balance),
          daily_loss_locked = false,
          updated_at = now()
    where id = 1
    returning * into v_portfolio;
  end if;

  select * into v_position from public.paper_positions where market_id = v_market for update;
  v_has_position := found;
  if v_has_position then
    update public.paper_positions
      set mark_price = v_bid, mark_updated_at = v_source_at
    where market_id = v_market;
  end if;

  select v_portfolio.cash_balance + coalesce(sum(quantity * mark_price), 0) into v_equity
  from public.paper_positions;
  if v_equity <= v_portfolio.daily_start_equity * (1 - v_config.daily_loss_limit_pct) then
    update public.paper_portfolio set daily_loss_locked = true, updated_at = now() where id = 1;
    v_portfolio.daily_loss_locked := true;
  end if;

  if v_has_position then
    v_reason := case
      when v_bid <= v_position.stop_loss then 'stop_loss'
      when v_bid >= v_position.take_profit then 'take_profit'
      when v_signal_type = 'SELL' and v_quality = 'validated' and v_expires_at > now() then 'signal_sell'
      else null
    end;
    if v_reason is null then
      update public.paper_portfolio set last_tick_at = now(), updated_at = now() where id = 1;
      return jsonb_build_object('status', 'marked', 'market_id', v_market, 'mark_price', v_bid, 'daily_loss_locked', v_portfolio.daily_loss_locked);
    end if;

    v_event_key := v_market || '|' || v_signal_id || '|close|' || to_char(v_source_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
    if exists (select 1 from public.paper_events where event_key = v_event_key) then
      return jsonb_build_object('status', 'duplicate', 'event_key', v_event_key);
    end if;
    v_exit_notional := v_position.quantity * v_bid;
    v_exit_fee := v_exit_notional * v_config.cfx_fee_rate;
    v_pnl := v_exit_notional - v_position.entry_notional - v_position.entry_fee - v_exit_fee;
    v_outcome := case when v_pnl > 0 then 'win' when v_pnl < 0 then 'loss' else 'breakeven' end;

    insert into public.paper_events(event_key, market_id, signal_id, event_action, reason, payload)
    values (v_event_key, v_market, v_signal_id, 'close', v_reason, p_event);
    insert into public.paper_trades (
      market_id, entry_signal_id, exit_signal_id, entry_price, exit_price, quantity,
      entry_notional, exit_notional, entry_fee, exit_fee, realized_net_pnl, outcome,
      close_reason, entry_at, exit_at, entry_source_at, exit_source_at, close_event_key
    ) values (
      v_market, v_position.signal_id, v_signal_id, v_position.entry_price, v_bid, v_position.quantity,
      v_position.entry_notional, v_exit_notional, v_position.entry_fee, v_exit_fee, v_pnl, v_outcome,
      v_reason, v_position.opened_at, now(), v_position.entry_source_at, v_source_at, v_event_key
    );
    delete from public.paper_positions where market_id = v_market;
    update public.paper_portfolio
      set cash_balance = cash_balance + v_exit_notional - v_exit_fee,
          realized_pnl = realized_pnl + v_pnl,
          last_tick_at = now(), updated_at = now()
    where id = 1;
    return jsonb_build_object(
      'status', 'closed', 'market_id', v_market, 'event_key', v_event_key,
      'reason', v_reason, 'price', v_bid, 'entry_fee', v_position.entry_fee,
      'exit_fee', v_exit_fee, 'realized_net_pnl', v_pnl, 'outcome', v_outcome
    );
  end if;

  v_event_key := v_market || '|' || v_signal_id || '|open|' || to_char(v_source_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  if exists (select 1 from public.paper_events where event_key = v_event_key)
     or exists (
       select 1 from public.paper_events
       where event_key = v_market || '|' || v_signal_id || '|close|' || to_char(v_source_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
     ) then
    return jsonb_build_object('status', 'duplicate', 'event_key', v_event_key);
  end if;

  if v_config.bot_status <> 'active' then return jsonb_build_object('status', 'blocked', 'reason', 'bot_not_active'); end if;
  if v_config.active_pair <> v_market then return jsonb_build_object('status', 'blocked', 'reason', 'pair_not_active'); end if;
  if v_portfolio.daily_loss_locked then return jsonb_build_object('status', 'blocked', 'reason', 'daily_loss_limit_reached'); end if;
  if v_signal_type <> 'BUY' or v_quality <> 'validated' or v_expires_at is null or v_expires_at <= now() then
    return jsonb_build_object('status', 'no_entry', 'reason', 'no_fresh_valid_buy_signal');
  end if;
  if v_entry_low is null or v_entry_high is null or v_stop is null or v_target is null
     or v_entry_low <= 0 or v_entry_high < v_entry_low or v_stop <= 0 or v_stop >= v_ask
     or v_target <= v_ask or v_ask < v_entry_low or v_ask > v_entry_high then
    return jsonb_build_object('status', 'no_entry', 'reason', 'ask_outside_range_or_invalid_levels');
  end if;
  if exists (select 1 from public.paper_positions where market_id = v_market) then
    return jsonb_build_object('status', 'blocked', 'reason', 'position_already_open');
  end if;

  v_notional := least(v_equity * v_config.position_size_pct, v_portfolio.cash_balance / (1 + v_config.cfx_fee_rate));
  if v_notional <= 0 then return jsonb_build_object('status', 'blocked', 'reason', 'insufficient_shared_cash'); end if;
  v_fee := v_notional * v_config.cfx_fee_rate;
  v_quantity := v_notional / v_ask;

  insert into public.paper_events(event_key, market_id, signal_id, event_action, reason, payload)
  values (v_event_key, v_market, v_signal_id, 'open', 'buy_signal_entry_range', p_event);
  insert into public.paper_positions (
    market_id, signal_id, quantity, entry_price, entry_notional, entry_fee,
    stop_loss, take_profit, mark_price, opened_at, entry_source_at,
    mark_updated_at, entry_event_key
  ) values (
    v_market, v_signal_id, v_quantity, v_ask, v_notional, v_fee,
    v_stop, v_target, v_bid, now(), v_source_at, v_source_at, v_event_key
  );
  update public.paper_portfolio
    set cash_balance = cash_balance - v_notional - v_fee,
        last_tick_at = now(), updated_at = now()
  where id = 1;
  return jsonb_build_object(
    'status', 'opened', 'market_id', v_market, 'event_key', v_event_key,
    'entry_price', v_ask, 'mark_price', v_bid, 'notional', v_notional,
    'quantity', v_quantity, 'entry_fee', v_fee, 'stop_loss', v_stop, 'take_profit', v_target
  );
end;
$$;
revoke all on function public.process_paper_tick(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.process_paper_tick(uuid, jsonb) to service_role;
