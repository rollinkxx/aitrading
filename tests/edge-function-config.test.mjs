import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('supabase/functions/market-collector/index.ts', 'utf8');
const config = JSON.parse(fs.readFileSync('supabase/functions/market-collector/deno.json', 'utf8'));

test('collector Edge Runtime types are pinned and Deno uses a lockfile', () => {
  assert.match(source, /jsr:@supabase\/functions-js@2\.119\.0\/edge-runtime\.d\.ts/);
  assert.equal(config.nodeModulesDir, 'auto');
  assert.equal(config.lock, 'deno.lock');
});

test('database fetch helper has bounded request timeouts', () => {
  assert.match(source, /AbortSignal\.timeout/);
  assert.match(source, /database deadline exceeded/);
  assert.match(source, /authenticate\(req, deadlineAt\)/);
  assert.match(source, /collect\(deadlineAt\)/);
});
