import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const migration = fs.readFileSync(new URL('../supabase/migrations/20261109060000_forensic_constraint_hardening.sql', import.meta.url), 'utf8')

test('forensic hardening rejects NULL lease duration and invalid partial entry levels', () => {
  assert.match(migration, /p_lease_seconds is null/)
  assert.match(migration, /entry_low is null or entry_low > 0/)
  assert.match(migration, /entry_high is null or entry_high > 0/)
  assert.match(migration, /drop constraint if exists signals_entry_order/)
})

test('forensic hardening preserves service-role-only collector claims', () => {
  assert.match(migration, /revoke all on function public\.claim_collector_run\(text, integer\) from public, anon, authenticated/)
  assert.match(migration, /grant execute on function public\.claim_collector_run\(text, integer\) to service_role/)
})
