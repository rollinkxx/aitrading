-- Atomic collector persistence and lease fencing.
-- Every business write and collector completion is committed together only while
-- the caller still owns the current lease.

create or replace function public.heartbeat_collector_run(
  p_run_id uuid,
  p_fencing_token bigint,
  p_lease_seconds integer default 90
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_run_id is null or p_fencing_token is null
     or p_lease_seconds is null or p_lease_seconds < 10 or p_lease_seconds > 900 then
    raise exception 'invalid collector heartbeat parameters';
  end if;

  update public.collector_runs
     set lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         heartbeat_at = now()
   where id = p_run_id
     and fencing_token = p_fencing_token
     and status = 'running'
     and lease_expires_at is not null
     and lease_expires_at > now();

  return found;
end;
$$;

create or replace function public.persist_collector_batch(
  p_run_id uuid,
  p_fencing_token bigint,
  p_markets jsonb default '[]'::jsonb,
  p_ticks jsonb default '[]'::jsonb,
  p_candles jsonb default '[]'::jsonb,
  p_indicators jsonb default '[]'::jsonb,
  p_signals jsonb default '[]'::jsonb,
  p_outcomes jsonb default '[]'::jsonb,
  p_expire_before timestamptz default now()
)
returns table(
  markets_count integer,
  ticks_count integer,
  candles_count integer,
  indicators_count integer,
  signals_count integer,
  outcomes_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_run public.collector_runs%rowtype;
  v_markets integer := 0;
  v_ticks integer := 0;
  v_candles integer := 0;
  v_indicators integer := 0;
  v_signals integer := 0;
  v_outcomes integer := 0;
begin
  if p_run_id is null or p_fencing_token is null then
    raise exception 'collector lease identity is required';
  end if;

  select * into current_run
    from public.collector_runs
   where id = p_run_id
   for update;

  if not found
     or current_run.status <> 'running'
     or current_run.fencing_token <> p_fencing_token
     or current_run.lease_expires_at is null
     or current_run.lease_expires_at <= now() then
    raise exception 'collector lease lost';
  end if;

  insert into public.markets(id, symbol, base_asset, quote_asset, status, source, last_synced_at)
  select x.id, x.symbol, x.base_asset, x.quote_asset, x.status, x.source, x.last_synced_at
    from jsonb_to_recordset(coalesce(p_markets, '[]'::jsonb)) as x(
      id text, symbol text, base_asset text, quote_asset text, status text, source text, last_synced_at timestamptz
    )
  on conflict (id) do update set
    symbol = excluded.symbol,
    base_asset = excluded.base_asset,
    quote_asset = excluded.quote_asset,
    status = excluded.status,
    source = excluded.source,
    last_synced_at = excluded.last_synced_at;
  get diagnostics v_markets = row_count;

  insert into public.market_ticks(
    market_id, last_price, best_bid, best_ask, volume_24h, high_24h, low_24h,
    source_timestamp, data_status
  )
  select x.market_id, x.last_price, x.best_bid, x.best_ask, x.volume_24h, x.high_24h,
         x.low_24h, x.source_timestamp, x.data_status
    from jsonb_to_recordset(coalesce(p_ticks, '[]'::jsonb)) as x(
      market_id text, last_price numeric, best_bid numeric, best_ask numeric,
      volume_24h numeric, high_24h numeric, low_24h numeric,
      source_timestamp timestamptz, data_status text
    );
  get diagnostics v_ticks = row_count;

  insert into public.candles(
    market_id, timeframe, open_time, close_time, open, high, low, close, volume, is_closed, source
  )
  select x.market_id, x.timeframe, x.open_time, x.close_time, x.open, x.high, x.low,
         x.close, x.volume, x.is_closed, x.source
    from jsonb_to_recordset(coalesce(p_candles, '[]'::jsonb)) as x(
      market_id text, timeframe text, open_time timestamptz, close_time timestamptz,
      open numeric, high numeric, low numeric, close numeric, volume numeric,
      is_closed boolean, source text
    )
  on conflict (market_id, timeframe, open_time) do update set
    close_time = excluded.close_time,
    open = excluded.open,
    high = excluded.high,
    low = excluded.low,
    close = excluded.close,
    volume = excluded.volume,
    is_closed = excluded.is_closed,
    source = excluded.source;
  get diagnostics v_candles = row_count;

  insert into public.indicators(
    market_id, timeframe, candle_time, ema_20, ema_50, ema_200, rsi, macd,
    macd_signal, atr, volume_ratio
  )
  select x.market_id, x.timeframe, x.candle_time, x.ema_20, x.ema_50, x.ema_200,
         x.rsi, x.macd, x.macd_signal, x.atr, x.volume_ratio
    from jsonb_to_recordset(coalesce(p_indicators, '[]'::jsonb)) as x(
      market_id text, timeframe text, candle_time timestamptz, ema_20 numeric,
      ema_50 numeric, ema_200 numeric, rsi numeric, macd numeric,
      macd_signal numeric, atr numeric, volume_ratio numeric
    )
  on conflict (market_id, timeframe, candle_time) do update set
    ema_20 = excluded.ema_20,
    ema_50 = excluded.ema_50,
    ema_200 = excluded.ema_200,
    rsi = excluded.rsi,
    macd = excluded.macd,
    macd_signal = excluded.macd_signal,
    atr = excluded.atr,
    volume_ratio = excluded.volume_ratio;
  get diagnostics v_indicators = row_count;

  insert into public.signals(
    market_id, signal_type, timeframe, confidence, reference_price, entry_low,
    entry_high, stop_loss, take_profit, risk_reward, reason_codes, reason_text,
    data_quality, expires_at, status, dedupe_key
  )
  select x.market_id, x.signal_type, x.timeframe, x.confidence, x.reference_price,
         x.entry_low, x.entry_high, x.stop_loss, x.take_profit, x.risk_reward,
         x.reason_codes, x.reason_text, x.data_quality, x.expires_at, x.status, x.dedupe_key
    from jsonb_to_recordset(coalesce(p_signals, '[]'::jsonb)) as x(
      market_id text, signal_type text, timeframe text, confidence numeric,
      reference_price numeric, entry_low numeric, entry_high numeric,
      stop_loss numeric, take_profit numeric, risk_reward numeric,
      reason_codes jsonb, reason_text text, data_quality text,
      expires_at timestamptz, status text, dedupe_key text
    )
  on conflict (dedupe_key) do nothing;
  get diagnostics v_signals = row_count;

  update public.signals
     set status = 'expired'
   where status = 'active'
     and expires_at is not null
     and expires_at < p_expire_before;

  insert into public.signal_outcomes(
    signal_id, exit_price, return_percentage, max_favorable_excursion,
    max_adverse_excursion, outcome, closed_at, evaluation_method
  )
  select x.signal_id, x.exit_price, x.return_percentage, x.max_favorable_excursion,
         x.max_adverse_excursion, x.outcome, x.closed_at, x.evaluation_method
    from jsonb_to_recordset(coalesce(p_outcomes, '[]'::jsonb)) as x(
      signal_id uuid, exit_price numeric, return_percentage numeric,
      max_favorable_excursion numeric, max_adverse_excursion numeric,
      outcome text, closed_at timestamptz, evaluation_method text
    )
  on conflict (signal_id) do nothing;
  get diagnostics v_outcomes = row_count;

  update public.signals s
     set status = 'closed'
    from jsonb_to_recordset(coalesce(p_outcomes, '[]'::jsonb)) as x(signal_id uuid)
   where s.id = x.signal_id and s.status = 'active';

  update public.collector_runs
     set finished_at = now(), status = 'completed',
         markets_count = v_markets, ticks_count = v_ticks,
         candles_count = v_candles, signals_count = v_signals,
         outcomes_count = v_outcomes, heartbeat_at = now(), lease_expires_at = now()
   where id = p_run_id and fencing_token = p_fencing_token and status = 'running';

  if not found then
    raise exception 'collector lease lost before completion';
  end if;

  return query select v_markets, v_ticks, v_candles, v_indicators, v_signals, v_outcomes;
end;
$$;

revoke all on function public.heartbeat_collector_run(uuid, bigint, integer) from public, anon, authenticated;
revoke all on function public.persist_collector_batch(uuid, bigint, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.heartbeat_collector_run(uuid, bigint, integer) to service_role;
grant execute on function public.persist_collector_batch(uuid, bigint, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, timestamptz) to service_role;
