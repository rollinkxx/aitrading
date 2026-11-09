import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

// This test is invoked only by `npm run test:integration` in the disposable
// PostgreSQL job. It intentionally refuses to silently skip missing setup.
test('all Supabase migrations replay and fenced collector invariants hold', () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required for disposable PostgreSQL');
  assert.equal(process.env.AITRADING_ALLOW_DATABASE_RESET, '1', 'explicit disposable-database opt-in is required');
  const result = spawnSync('node', ['scripts/test-postgres.mjs'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /migration replay and assertions passed/);
  assert.match(result.stdout, /concurrent claim fencing assertion passed/);
  assert.match(result.stdout, /service-role-only RPC permission assertion passed/);
});
