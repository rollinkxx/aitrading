-- The forensic hardening migration retains the applied function signature but
-- this forward migration preserves the first-claim return value after insert.
create or replace function public.claim_collector_run(
  p_run_key text,
  p_lease_seconds integer default 90
)
returns table(run_id uuid, fencing_token bigint, claimed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_run public.collector_runs%rowtype;
  inserted_id uuid;
  next_token bigint;
begin
  if p_run_key is null or p_run_key = '' or p_lease_seconds is null
     or p_lease_seconds < 10 or p_lease_seconds > 900 then
    raise exception 'invalid collector claim parameters';
  end if;

  insert into public.collector_runs(run_key, status, fencing_token, lease_expires_at, heartbeat_at)
  values (p_run_key, 'running', 1, now() + make_interval(secs => p_lease_seconds), now())
  on conflict (run_key) do nothing
  returning id into inserted_id;

  if inserted_id is not null then
    return query select inserted_id, 1::bigint, true;
    return;
  end if;

  select * into current_run from public.collector_runs where run_key = p_run_key for update;
  if current_run.status = 'completed'
     or (current_run.status = 'running' and current_run.lease_expires_at is not null and current_run.lease_expires_at > now()) then
    return query select current_run.id, current_run.fencing_token, false;
    return;
  end if;

  next_token := greatest(coalesce(current_run.fencing_token, 0) + 1, 1);
  update public.collector_runs
     set status = 'running', started_at = now(), finished_at = null,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         heartbeat_at = now(), fencing_token = next_token, error_message = null
   where id = current_run.id;
  return query select current_run.id, next_token, true;
end;
$$;

revoke all on function public.claim_collector_run(text, integer) from public, anon, authenticated;
grant execute on function public.claim_collector_run(text, integer) to service_role;
