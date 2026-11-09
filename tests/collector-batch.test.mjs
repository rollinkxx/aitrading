import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync('supabase/migrations/20261109070000_atomic_collector_batch.sql', 'utf8');
const collector = fs.readFileSync('supabase/functions/market-collector/index.ts', 'utf8');

test('atomic batch migration validates the lease inside the transaction', () => {
  assert.match(migration, /select \* into current_run[\s\S]*for update/);
  assert.match(migration, /current_run\.fencing_token <> p_fencing_token/);
  assert.match(migration, /current_run\.lease_expires_at <= now\(\)/);
  assert.match(migration, /create or replace function public\.persist_collector_batch/);
  assert.match(migration, /update public\.collector_runs[\s\S]*status = 'completed'/);
});

test('stale workers cannot persist or heartbeat through the RPC contract', () => {
  assert.match(migration, /create or replace function public\.heartbeat_collector_run/);
  assert.match(migration, /grant execute on function public\.persist_collector_batch[\s\S]*service_role/);
  assert.match(collector, /rpc\/heartbeat_collector_run/);
  assert.match(collector, /rpc\/persist_collector_batch/);
  assert.doesNotMatch(collector, /POST.*signals\?status|POST.*market_ticks|POST.*candles|POST.*indicators/);
});

test('batch includes all business layers and outcomes in one request', () => {
  for (const field of ['p_markets', 'p_ticks', 'p_candles', 'p_indicators', 'p_signals', 'p_outcomes']) {
    assert.match(collector, new RegExp(field));
    assert.match(migration, new RegExp(field));
  }
});

test('collector applies strict market-data validation before signal generation', () => {
  assert.match(collector, /normalizeDepth, validDepth, validTicker/);
  assert.match(collector, /if \(!depth \|\| !validDepth\(depth\) \|\| !validTicker\(ticker\)\) continue/);
  assert.match(collector, /x\.time <= now \+ 60_000/);
  assert.match(collector, /toCandles\(raw15, "15", now\)/);
});
