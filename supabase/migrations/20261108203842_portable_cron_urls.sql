do $migration$
declare
  existing_job_id bigint;
  supabase_url text := nullif(current_setting('app.settings.supabase_url', true), '');
  checker_command text;
  collector_command text;
begin
  if supabase_url is null then
    select decrypted_secret into supabase_url from vault.decrypted_secrets where name = 'supabase_url' limit 1;
  end if;
  if supabase_url is null or supabase_url = '' then raise exception 'app.settings.supabase_url or Vault secret supabase_url is required'; end if;
  checker_command := format($cmd$select net.http_post(url := %L, headers := jsonb_build_object('Content-Type', 'application/json', 'x-collector-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'collector_shared_secret')), body := '{"mode":"check_active"}'::jsonb);$cmd$, rtrim(supabase_url, '/') || '/functions/v1/signal-checker');
  collector_command := format($cmd$select net.http_post(url := %L, headers := jsonb_build_object('Content-Type', 'application/json', 'x-collector-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'collector_shared_secret')), body := '{"mode":"collect","source":"pg_cron"}'::jsonb, timeout_milliseconds := 30000);$cmd$, rtrim(supabase_url, '/') || '/functions/v1/market-collector');
  select jobid into existing_job_id from cron.job where jobname = 'aitrading-active-signal-checker' limit 1;
  if existing_job_id is not null then perform cron.unschedule(existing_job_id); end if;
  perform cron.schedule('aitrading-active-signal-checker', '* * * * *', checker_command);
  select jobid into existing_job_id from cron.job where jobname = 'aitrading-market-collector' limit 1;
  if existing_job_id is not null then perform cron.unschedule(existing_job_id); end if;
  perform cron.schedule('aitrading-market-collector', '*/5 * * * *', collector_command);
end;
$migration$;
