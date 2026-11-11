-- Enable only after `paper-engine` is deployed to the isolated aitrading-paper project.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret(
  'https://xkhsxjyleqnhuptesepg.supabase.co',
  'paper_project_url',
  'Public base URL for the isolated paper Supabase project'
);
select vault.create_secret(
  'sb_publishable_4iXim8SwDjplb0T8G6R8Ag_QtRQ9ZxN',
  'paper_publishable_key',
  'Public API key for invoking the paper-only scheduled Edge Function'
);

do $$
declare
  v_job record;
begin
  for v_job in select jobid from cron.job where jobname = 'aitrading-paper-engine' loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'aitrading-paper-engine',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'paper_project_url') || '/functions/v1/paper-engine',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'paper_publishable_key'),
      'x-paper-trigger', (select decrypted_secret from vault.decrypted_secrets where name = 'paper_engine_trigger')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
