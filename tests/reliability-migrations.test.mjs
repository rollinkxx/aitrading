import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");

test("applied lease migrations preserve the staged claim fix and sampled outcome method", async () => {
  const leaseSql = await read("20261108203808_collector_leases_and_outcome_method.sql");
  const claimFixSql = await read("20261108204828_fix_initial_lease_claim.sql");
  assert.match(leaseSql, /create or replace function public\.claim_collector_run/);
  assert.match(leaseSql, /for update/);
  assert.match(leaseSql, /lease_expires_at/);
  assert.match(leaseSql, /fencing_token/);
  assert.match(leaseSql, /evaluation_method text not null default 'snapshot_sampled'/);
  assert.doesNotMatch(leaseSql, /returning id into inserted_id/);
  assert.match(claimFixSql, /returning id into inserted_id/);
  assert.match(claimFixSql, /return query select inserted_id, 1::bigint, true/);
});

test("expired collector leases are marked failed before a new claim", async () => {
  const sql = await read("20261108205158_mark_expired_collector_runs_failed.sql");
  assert.match(sql, /status = 'failed'/);
  assert.match(sql, /lease_expires_at <= now\(\)/);
  assert.match(sql, /run_key <> p_run_key/);
});

test("portable cron migration has no project-specific function URL", async () => {
  const sql = await read("20261108203842_portable_cron_urls.sql");
  assert.doesNotMatch(sql, /https:\/\/[^' ]+\/functions\/v1/);
  assert.match(sql, /vault\.decrypted_secrets/);
  assert.match(sql, /cron\.unschedule/);
  assert.match(sql, /aitrading-active-signal-checker/);
  assert.match(sql, /aitrading-market-collector/);
});
