do $migration$
declare
  existing_job_id bigint;
begin
  select jobid
    into existing_job_id
    from cron.job
   where jobname = 'aitrading-market-collector'
   limit 1;
  if existing_job_id is not null then
    perform cron.unschedule(existing_job_id);
  end if;
  perform cron.schedule(
    'aitrading-market-collector',
    '*/5 * * * *',
    $job$
      select net.http_post(
        url := 'https://hlxiyprvygakfwreynvn.supabase.co/functions/v1/market-collector',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-collector-secret', (
            select decrypted_secret
              from vault.decrypted_secrets
             where name = 'collector_shared_secret'
          )
        ),
        body := '{"mode":"collect","source":"pg_cron"}'::jsonb,
        timeout_milliseconds := 30000
      );
    $job$
  );
end;
$migration$;
