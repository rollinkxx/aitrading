import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const migrationDir = new URL("../supabase/migrations/", import.meta.url);
const read = name => readFile(new URL(name, migrationDir), "utf8");

test("initial collector lease migration installs lease fields and sampled outcome method", async () => {
  const sql = await read("20261108203808_collector_leases_and_outcome_method.sql");
  assert.match(sql, /create or replace function public\.claim_collector_run/);
  assert.match(sql, /for update/);
  assert.doesNotMatch(sql, /returning id into inserted_id/);
  assert.match(sql, /lease_expires_at/);
  assert.match(sql, /fencing_token/);
  assert.match(sql, /evaluation_method text not null default 'snapshot_sampled'/);
});

test("first-claim fix returns the inserted row before locking an existing run", async () => {
  const sql = await read("20261108204828_fix_initial_lease_claim.sql");
  assert.match(sql, /returning id into inserted_id/);
  assert.match(sql, /return query select inserted_id, 1::bigint, true/);
  assert.ok(sql.indexOf("returning id into inserted_id") < sql.indexOf("for update"));
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
  assert.match(sql, /'\* \* \* \* \*'/);
  assert.match(sql, /'\*\/5 \* \* \* \*'/);
});

test("local migration filenames use the four applied Supabase IDs", async () => {
  const names = await readdir(migrationDir);
  const appliedIds = ["20261108203808", "20261108203842", "20261108204828", "20261108205158"];
  const relevant = names.filter(name => appliedIds.some(id => name.startsWith(id))).sort();
  assert.deepEqual(relevant, [
    "20261108203808_collector_leases_and_outcome_method.sql",
    "20261108203842_portable_cron_urls.sql",
    "20261108204828_fix_initial_lease_claim.sql",
    "20261108205158_mark_expired_collector_runs_failed.sql",
  ]);
});
