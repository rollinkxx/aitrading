create index if not exists signals_active_directional_market_tf_idx
  on public.signals (market_id, timeframe, signal_type)
  where status = 'active' and signal_type in ('BUY', 'SELL');

create or replace function public.expire_opposite_active_signal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'active' and new.signal_type in ('BUY', 'SELL') then
    update public.signals as existing
       set status = 'expired'
     where existing.market_id = new.market_id
       and existing.timeframe = new.timeframe
       and existing.status = 'active'
       and existing.signal_type in ('BUY', 'SELL')
       and existing.signal_type <> new.signal_type;
  end if;
  return new;
end;
$$;

revoke all on function public.expire_opposite_active_signal() from public, anon, authenticated;
grant execute on function public.expire_opposite_active_signal() to service_role;

drop trigger if exists signals_supersede_opposite_active on public.signals;
create trigger signals_supersede_opposite_active
before insert on public.signals
for each row execute function public.expire_opposite_active_signal();
