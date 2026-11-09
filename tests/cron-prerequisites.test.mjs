import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20261109080000_validate_cron_prerequisites.sql', 'utf8');

test('cron configuration requires an HTTPS Supabase URL and non-empty Vault secret', () => {
  assert.match(migration, /collector_shared_secret/);
  assert.ok(migration.includes("v_url !~ '^https://[[:alnum:].-]+/?$'"));
  assert.match(migration, /raise exception 'valid https supabase_url and non-empty Vault collector_shared_secret are required'/);
});

test('missing prerequisites unschedule both jobs without leaking secret material', () => {
  assert.match(migration, /for v_job in[\s\S]*cron\.unschedule\(v_job\.jobid\)/);
  assert.match(migration, /aitrading-active-signal-checker/);
  assert.match(migration, /aitrading-market-collector/);
  assert.match(migration, /select decrypted_secret from vault\.decrypted_secrets where name = 'collector_shared_secret'/);
  assert.doesNotMatch(migration, /format\([^;]*collector_shared_secret[^;]*%L/s);
});

test('manual cron activation is service-role-only and idempotent', () => {
  assert.match(migration, /create or replace function public\.configure_aitrading_cron/);
  assert.match(migration, /revoke all on function public\.configure_aitrading_cron\(\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.configure_aitrading_cron\(\) to service_role/);
  assert.match(migration, /perform public\.configure_aitrading_cron\(\)/);
});
