import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { readNotificationsEnabled, readWatchlist, persistWatchlist } from '../src/lib/storage.ts'

function installStorage(implementation) {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: implementation,
  })
}

test('watchlist storage recovers from malformed JSON, wrong shape, and unsafe IDs', () => {
  const original = globalThis.localStorage
  try {
    installStorage({ getItem: () => '{bad' })
    assert.deepEqual(readWatchlist(), ['btcidr', 'ethidr', 'solidr'])
    installStorage({ getItem: () => '{"not":"an array"}' })
    assert.deepEqual(readWatchlist(), ['btcidr', 'ethidr', 'solidr'])
    installStorage({ getItem: () => '["btcidr",7,"evil<script>idr","ethidr","btcidr"]' })
    assert.deepEqual(readWatchlist(), ['btcidr', 'ethidr'])
  } finally {
    if (original === undefined) delete globalThis.localStorage
    else installStorage(original)
  }
})

test('storage access failure never prevents UI state initialization or persistence', () => {
  const original = globalThis.localStorage
  try {
    installStorage({
      getItem() { throw new DOMException('blocked', 'SecurityError') },
      setItem() { throw new DOMException('full', 'QuotaExceededError') },
    })
    assert.deepEqual(readWatchlist(), ['btcidr', 'ethidr', 'solidr'])
    assert.equal(readNotificationsEnabled(), false)
    assert.doesNotThrow(() => persistWatchlist(['btcidr']))
  } finally {
    if (original === undefined) delete globalThis.localStorage
    else installStorage(original)
  }
})

test('collector_runs historical migration exists before indexes and keeps diagnostics private', async () => {
  const source = await readFile(new URL('../supabase/migrations/20261107090437_background_collector.sql', import.meta.url), 'utf8')
  const indexes = await readFile(new URL('../supabase/migrations/20261107092739_collector_security_indexes.sql', import.meta.url), 'utf8')
  assert.match(source, /create table if not exists public\.collector_runs/i)
  assert.match(source, /run_key text not null unique/i)
  assert.match(source, /error_message text/i)
  assert.match(source, /enable row level security/i)
  assert.match(source, /revoke all on table public\.collector_runs from public, anon, authenticated/i)
  assert.match(source, /grant all on table public\.collector_runs to service_role/i)
  assert.ok(indexes.indexOf('collector_runs_started') >= 0)
  const files = (await readdir(new URL('../supabase/migrations/', import.meta.url)))
    .filter(name => name === '20261107090437_background_collector.sql' || name === '20261107092739_collector_security_indexes.sql')
    .sort()
  assert.deepEqual(files, ['20261107090437_background_collector.sql', '20261107092739_collector_security_indexes.sql'])
})
