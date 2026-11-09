import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const execFileAsync = promisify(execFile);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required for PostgreSQL integration tests');
  process.exit(2);
}
let parsed;
try { parsed = new URL(databaseUrl); }
catch { console.error('DATABASE_URL is invalid'); process.exit(2); }
if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) {
  console.error('Refusing to replay migrations against a remote database; use disposable localhost PostgreSQL');
  process.exit(2);
}
if (process.env.AITRADING_ALLOW_DATABASE_RESET !== '1') {
  console.error('Set AITRADING_ALLOW_DATABASE_RESET=1 only for a disposable integration database');
  process.exit(2);
}

const root = path.resolve(new URL('..', import.meta.url).pathname);
const migrations = fs.readdirSync(path.join(root, 'supabase/migrations')).filter(name => name.endsWith('.sql')).sort();
const prelude = String.raw`
\set ON_ERROR_STOP on
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_roles where rolname = 'service_role') then
    raise exception 'integration database must provision anon, authenticated, and service_role roles first';
  end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create schema if not exists vault;
create table if not exists vault.decrypted_secrets (name text primary key, decrypted_secret text);
insert into vault.decrypted_secrets(name, decrypted_secret) values ('supabase_url', 'https://example.supabase.co'), ('collector_shared_secret', 'integration-secret') on conflict (name) do update set decrypted_secret = excluded.decrypted_secret;
create schema if not exists cron;
create table if not exists cron.job (jobid bigint generated always as identity primary key, jobname text unique, schedule text, command text);
create or replace function cron.unschedule(p_jobid bigint) returns void language sql as $$ delete from cron.job where jobid = p_jobid $$;
create or replace function cron.schedule(p_jobname text, p_schedule text, p_command text) returns bigint language plpgsql as $$ declare v_id bigint; begin insert into cron.job(jobname, schedule, command) values (p_jobname, p_schedule, p_command) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid into v_id; return v_id; end $$;
create schema if not exists net;
create or replace function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer default null) returns bigint language sql as $$ select 1::bigint $$;
create table if not exists public.migration_constraint_collision (value integer);
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.migration_constraint_collision'::regclass and conname = 'market_ticks_positive_prices') then
    alter table public.migration_constraint_collision add constraint market_ticks_positive_prices check (value >= 0);
  end if;
end $$;
`;
const assertions = String.raw`
\set ON_ERROR_STOP on
truncate table public.signal_outcomes, public.signals, public.indicators, public.candles, public.market_ticks, public.markets, public.collector_runs cascade;
do $$ declare r record; b record; begin
  select * into r from public.claim_collector_run('integration-run', 90);
  if not r.claimed then raise exception 'claim did not succeed'; end if;
  select * into b from public.persist_collector_batch(
    r.run_id, r.fencing_token,
    '[{"id":"btcidr","symbol":"BTCIDR","base_asset":"BTC","quote_asset":"IDR","status":"active","source":"test","last_synced_at":"2026-01-01T00:00:00Z"}]'::jsonb,
    '[{"market_id":"btcidr","last_price":100,"best_bid":99,"best_ask":101,"volume_24h":1000,"high_24h":110,"low_24h":90,"source_timestamp":"2026-01-01T00:00:00Z","data_status":"validated"}]'::jsonb,
    '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, now()
  );
  if b.markets_count <> 1 or b.ticks_count <> 1 then raise exception 'batch counts incorrect'; end if;
  if (select status from public.collector_runs where run_key = 'integration-run') <> 'completed' then raise exception 'run was not completed'; end if;
end $$;
do $$ declare r record; begin
  select * into r from public.claim_collector_run('stale-run', 90);
  update public.collector_runs set fencing_token = r.fencing_token + 1 where id = r.run_id;
  begin
    perform public.persist_collector_batch(r.run_id, r.fencing_token, '[{"id":"stale","symbol":"STALE","base_asset":"STALE","quote_asset":"IDR","status":"active","source":"test","last_synced_at":"2026-01-01T00:00:00Z"}]'::jsonb);
    raise exception 'stale write was accepted';
  exception when others then
    if position('lease lost' in sqlerrm) = 0 then raise; end if;
  end;
  if exists (select 1 from public.markets where id = 'stale') then raise exception 'stale write partially committed'; end if;
end $$;
do $$ declare r record; begin
  select * into r from public.claim_collector_run('rollback-run', 90);
  begin
    perform public.persist_collector_batch(r.run_id, r.fencing_token, '[{"id":"rollback","symbol":"ROLLBACK","base_asset":"ROLLBACK","quote_asset":"IDR","status":"active","source":"test","last_synced_at":"2026-01-01T00:00:00Z"}]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[{"market_id":"rollback","signal_type":"BUY","timeframe":"15m","confidence":101,"reason_codes":[],"reason_text":"invalid","data_quality":"validated","status":"active","dedupe_key":"rollback:invalid"}]'::jsonb);
    raise exception 'invalid batch was accepted';
  exception when others then
    if position('signals_confidence_check' in sqlerrm) = 0 then raise; end if;
  end;
  if exists (select 1 from public.markets where id = 'rollback') then raise exception 'failed batch partially committed'; end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.market_ticks'::regclass and conname = 'market_ticks_positive_prices') then raise exception 'collision repair did not add target constraint'; end if;
  begin
    update public.market_ticks set last_price = 0 where market_id = 'btcidr';
    raise exception 'invalid zero ticker price was accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.claim_collector_run('invalid-null-lease', null);
    raise exception 'NULL lease duration was accepted';
  exception when others then
    if position('invalid collector claim parameters' in sqlerrm) = 0 then raise; end if;
  end;
end $$;
do $$ begin
  if (select count(*) from cron.job where jobname in ('aitrading-active-signal-checker','aitrading-market-collector')) <> 2 then raise exception 'cron prerequisites did not create exactly two jobs'; end if;
  if not exists (select 1 from cron.job where jobname='aitrading-active-signal-checker' and schedule='* * * * *') then raise exception 'checker schedule is wrong'; end if;
  if not exists (select 1 from cron.job where jobname='aitrading-market-collector' and schedule='*/5 * * * *') then raise exception 'collector schedule is wrong'; end if;
end $$;
select 'postgres migration replay and assertions passed' as result;
`;

const sql = [prelude, ...migrations.map(file => fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8')), assertions].join('\n');
const result = spawnSync('psql', ['--no-psqlrc', '--quiet', databaseUrl], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
if (result.status !== 0) process.exit(result.status ?? 1);

const query = "select run_id::text || '|' || fencing_token::text || '|' || claimed::text from public.claim_collector_run('parallel-claim-run', 90)";
const args = ['--no-psqlrc', '--quiet', '--tuples-only', '--no-align', databaseUrl, '--command', query];
const claims = await Promise.all([execFileAsync('psql', args), execFileAsync('psql', args)]);
const claimed = claims.map(result => result.stdout.trim().split('|').at(-1) === 'true');
if (claimed.filter(Boolean).length !== 1) {
  console.error(`expected exactly one concurrent lease owner; got ${claims.map(result => result.stdout.trim()).join(', ')}`);
  process.exit(1);
}
console.log('concurrent claim fencing assertion passed');

const anon = spawnSync('psql', ['--no-psqlrc', '--quiet', databaseUrl, '--command', "set role anon; select public.claim_collector_run('anon-claim', 90);"], { encoding: 'utf8' });
if (anon.status === 0) {
  console.error('anon unexpectedly executed service-role-only collector claim');
  process.exit(1);
}
console.log('service-role-only RPC permission assertion passed');
