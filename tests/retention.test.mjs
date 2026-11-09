import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20261109070001_operational_indexes_retention.sql', 'utf8');

test('tick retention requires a 14-day minimum cutoff and bounded batch size', () => {
  assert.match(migration, /p_before timestamptz default now\(\) - interval '14 days'/);
  assert.match(migration, /p_before > now\(\) - interval '14 days'/);
  assert.match(migration, /p_batch_size > 10000/);
  assert.match(migration, /limit p_batch_size[\s\S]*for update skip locked/);
});

test('retention stays manual and service-role-only', () => {
  assert.doesNotMatch(migration, /cron\.schedule/);
  assert.match(migration, /revoke all on function public\.prune_old_market_ticks\(timestamptz, integer\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.prune_old_market_ticks\(timestamptz, integer\) to service_role/);
});
