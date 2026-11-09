-- Keep scheduled requests fail-closed when an installation is missing runtime
-- prerequisites. The secret is never copied into cron.job.command; it is read
-- from Vault for every request.
create or replace function public.configure_aitrading_cron()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, cron, vault, net
as $$
declare
  v_url text := nullif(current_setting('app.settings.supabase_url', true), '');
  v_secret text;
  v_job_id bigint;
  v_checker_command text;
  v_collector_command text;
begin
  if v_url is null then
    select nullif(trim(decrypted_secret), '') into v_url
      from vault.decrypted_secrets where name = 'supabase_url' limit 1;
  end if;
  select nullif(trim(decrypted_secret), '') into v_secret
    from vault.decrypted_secrets where name = 'collector_shared_secret' limit 1;

  if v_url is null or v_url !~ '^https://[[:alnum:].-]+/?$' or v_secret is null then
    raise exception 'valid https supabase_url and non-empty Vault collector_shared_secret are required';
  end if;

  v_checker_command := format(
    $cmd$select net.http_post(url := %L, headers := jsonb_build_object('Content-Type', 'application/json', 'x-collector-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'collector_shared_secret')), body := '{"mode":"check_active"}'::jsonb);$cmd$,
    rtrim(v_url, '/') || '/functions/v1/signal-checker'
  );
  v_collector_command := format(
    $cmd$select net.http_post(url := %L, headers := jsonb_build_object('Content-Type', 'application/json', 'x-collector-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'collector_shared_secret')), body := '{"mode":"collect","source":"pg_cron"}'::jsonb, timeout_milliseconds := 30000);$cmd$,
    rtrim(v_url, '/') || '/functions/v1/market-collector'
  );

  for v_job_id in select jobid from cron.job where jobname = 'aitrading-active-signal-checker' loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule('aitrading-active-signal-checker', '* * * * *', v_checker_command);

  for v_job_id in select jobid from cron.job where jobname = 'aitrading-market-collector' loop
    perform cron.unschedule(v_job_id);
  end loop;
  perform cron.schedule('aitrading-market-collector', '*/5 * * * *', v_collector_command);
end;
$$;

revoke all on function public.configure_aitrading_cron() from public, anon, authenticated;
grant execute on function public.configure_aitrading_cron() to service_role;

do $$
declare
  v_url text := nullif(current_setting('app.settings.supabase_url', true), '');
  v_secret text;
  v_job record;
begin
  if v_url is null then
    select nullif(trim(decrypted_secret), '') into v_url
      from vault.decrypted_secrets where name = 'supabase_url' limit 1;
  end if;
  select nullif(trim(decrypted_secret), '') into v_secret
    from vault.decrypted_secrets where name = 'collector_shared_secret' limit 1;

  if v_url is null or v_url !~ '^https://[[:alnum:].-]+/?$' or v_secret is null then
    for v_job in
      select jobid from cron.job
       where jobname in ('aitrading-active-signal-checker', 'aitrading-market-collector')
    loop
      perform cron.unschedule(v_job.jobid);
    end loop;
    raise warning 'AITrading cron jobs were disabled: configure https supabase_url and Vault collector_shared_secret, then call public.configure_aitrading_cron()';
  else
    perform public.configure_aitrading_cron();
  end if;
end;
$$;
