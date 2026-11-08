import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");

test("collector lease migration fences stale workers and labels sampled outcomes", async () => {
  const sql = await read("20261109040000_collector_leases_and_outcome_method.sql");
  assert.match(sql, /create or replace function public\.claim_collector_run/);
  assert.match(sql, /for update/);
  assert.match(sql, /returning id into inserted_id/);
  assert.match(sql, /return query select inserted_id, 1::bigint, true/);
  assert.match(sql, /lease_expires_at/);
  assert.match(sql, /fencing_token/);
  assert.match(sql, /evaluation_method text not null default 'snapshot_sampled'/);
});

test("expired collector leases are marked failed before a new claim", async () => {
  const sql = await read("20261109051000_mark_expired_collector_runs_failed.sql");
  assert.match(sql, /status = 'failed'/);
  assert.match(sql, /lease_expires_at <= now\(\)/);
  assert.match(sql, /run_key <> p_run_key/);
});

test("portable cron migration has no project-specific function URL", async () => {
  const sql = await read("20261109040001_portable_cron_urls.sql");
  assert.doesNotMatch(sql, /https:\/\/[^' ]+\/functions\/v1/);
  assert.match(sql, /vault\.decrypted_secrets/);
  assert.match(sql, /cron\.unschedule/);
  assert.match(sql, /aitrading-active-signal-checker/);
  assert.match(sql, /aitrading-market-collector/);
});
