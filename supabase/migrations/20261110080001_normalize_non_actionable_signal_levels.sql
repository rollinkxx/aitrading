create or replace function public.normalize_non_actionable_signal_levels()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.signal_type in ('HOLD', 'WAIT') then
    new.entry_low := null;
    new.entry_high := null;
    new.stop_loss := null;
    new.take_profit := null;
    new.risk_reward := null;
  end if;
  return new;
end;
$$;

drop trigger if exists normalize_non_actionable_signal_levels on public.signals;
create trigger normalize_non_actionable_signal_levels
before insert or update of signal_type, entry_low, entry_high, stop_loss, take_profit, risk_reward
on public.signals
for each row execute function public.normalize_non_actionable_signal_levels();
