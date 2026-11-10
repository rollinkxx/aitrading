-- HOLD/WAIT are informational states; they must not carry executable levels.
update public.signals
set entry_low = null,
    entry_high = null,
    stop_loss = null,
    take_profit = null,
    risk_reward = null
where signal_type in ('HOLD', 'WAIT')
  and (entry_low is not null or entry_high is not null or stop_loss is not null or take_profit is not null or risk_reward is not null);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.signals'::regclass
      and conname = 'signals_non_actionable_levels_null'
  ) then
    alter table public.signals add constraint signals_non_actionable_levels_null
      check (
        signal_type not in ('HOLD', 'WAIT')
        or (entry_low is null and entry_high is null and stop_loss is null and take_profit is null and risk_reward is null)
      ) not valid;
  end if;
end;
$$;
