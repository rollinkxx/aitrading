-- The historical integrity migration checked conname globally. Repair any
-- constraint it skipped because another relation used the same name.
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.market_ticks'::regclass and conname = 'market_ticks_positive_prices') then
    alter table public.market_ticks add constraint market_ticks_positive_prices
      check (last_price > 0 and (best_bid is null or best_bid > 0) and (best_ask is null or best_ask > 0) and (high_24h is null or high_24h >= 0) and (low_24h is null or low_24h >= 0)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.market_ticks'::regclass and conname = 'market_ticks_bid_ask_order') then
    alter table public.market_ticks add constraint market_ticks_bid_ask_order
      check (best_bid is null or best_ask is null or best_bid <= best_ask) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.candles'::regclass and conname = 'candles_ohlc_shape') then
    alter table public.candles add constraint candles_ohlc_shape
      check (open > 0 and high >= greatest(open, close) and low <= least(open, close) and low > 0 and volume >= 0 and close_time > open_time) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.signals'::regclass and conname = 'signals_level_invariants') then
    alter table public.signals add constraint signals_level_invariants
      check (
        signal_type in ('HOLD', 'WAIT')
        or (reference_price is not null and reference_price > 0 and stop_loss is not null and stop_loss > 0 and take_profit is not null and take_profit > 0
          and ((signal_type = 'BUY' and stop_loss < reference_price and take_profit > reference_price)
            or (signal_type = 'SELL' and stop_loss > reference_price and take_profit < reference_price)))
      ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.signals'::regclass and conname = 'signals_entry_order') then
    alter table public.signals add constraint signals_entry_order
      check ((entry_low is null or entry_low > 0) and (entry_high is null or entry_high > 0) and (entry_low is null or entry_high is null or entry_low <= entry_high)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.signal_outcomes'::regclass and conname = 'signal_outcomes_positive_exit') then
    alter table public.signal_outcomes add constraint signal_outcomes_positive_exit
      check (exit_price is null or exit_price > 0) not valid;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_index i
     where i.indrelid = 'public.signal_outcomes'::regclass
       and i.indisunique and i.indisvalid
       and pg_get_indexdef(i.indexrelid) like '%(signal_id)%'
  ) then
    create unique index signal_outcomes_signal_target_unique on public.signal_outcomes(signal_id);
  end if;
end;
$$;
