import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

const migrationPath = new URL('../supabase-paper/migrations/20261110220000_paper_trading.sql', import.meta.url)
const functionPath = new URL('../supabase-paper/functions/paper-engine/index.ts', import.meta.url)
const sharedRoot = new URL('../supabase/functions/_shared/', import.meta.url)
const sharedBundle = new URL('../supabase-paper/functions/paper-engine/_shared/', import.meta.url)

test('paper migration seeds the agreed shared balance, selected-pair defaults, position cap, daily guard and CFX-only fee', async () => {
  const sql = await readFile(migrationPath, 'utf8')
  assert.match(sql, /values\s*\(1,\s*100000000,\s*'btcidr',\s*'active',\s*0\.10,\s*0\.02,\s*0\.0000555/i)
  assert.match(sql, /timezone\('Asia\/Jakarta',\s*now\(\)\)::date/i)
  assert.match(sql, /daily_start_equity\s*\*\s*\(1\s*-\s*v_config\.daily_loss_limit_pct\)/i)
  assert.match(sql, /price_source text not null default 'indodax_public_api'/i)
})

test('raw ledger tables are not directly writable and state-changing engine RPCs are service-only', async () => {
  const sql = await readFile(migrationPath, 'utf8')
  assert.match(sql, /alter table public\.paper_positions enable row level security/i)
  assert.match(sql, /revoke all on table public\.paper_config, public\.paper_portfolio, public\.paper_positions, public\.paper_events, public\.paper_control_events, public\.paper_trades from public, anon, authenticated/i)
  assert.match(sql, /revoke all on function public\.process_paper_tick\(uuid, jsonb\) from public, anon, authenticated/i)
  assert.match(sql, /grant execute on function public\.process_paper_tick\(uuid, jsonb\) to service_role/i)
  assert.match(sql, /unique \(\)|market_id text primary key/i)
})

test('only narrowly-scoped paper controls and safe reads are exposed publicly', async () => {
  const sql = await readFile(migrationPath, 'utf8')
  assert.match(sql, /grant execute on function public\.set_paper_control\(text, text\) to anon, authenticated/i)
  assert.match(sql, /grant execute on function public\.get_paper_public_state\(\) to anon, authenticated/i)
  assert.match(sql, /grant select on public\.paper_public_history to anon, authenticated/i)
  assert.match(sql, /insert into public\.paper_control_events/i)
  assert.match(sql, /p_value !~ '\^\[a-z0-9\]\{2,20\}idr\$'/i)
})

test('server tick requires a fresh lease token and the scheduled trigger secret', async () => {
  const sql = await readFile(migrationPath, 'utf8')
  const fn = await readFile(functionPath, 'utf8')
  assert.match(sql, /run_lock_token is distinct from p_run_token/i)
  assert.match(sql, /run_lease_until <= now\(\)/i)
  assert.match(sql, /vault\.create_secret\(v_trigger_secret, 'paper_engine_trigger'/i)
  assert.match(fn, /request\.headers\.get\("x-paper-trigger"\)/i)
  assert.match(fn, /verify_paper_trigger_secret/i)
  assert.match(fn, /request\.method !== "POST"/i)
  assert.match(fn, /https:\/\/indodax\.com/i)
  assert.doesNotMatch(fn, /private_api|place_order|order_placement|api\/trade/i)
})

test('paper-only resources stay outside the standard production migration/function directories', async () => {
  const standardMigrations = await readdir(new URL('../supabase/migrations/', import.meta.url))
  assert.equal(standardMigrations.some(name => name.includes('paper_trading') || name.includes('schedule_paper_engine')), false)
  const sharedFiles = ['strategy.ts', 'market-quality.ts', 'paper-engine.ts']
  for (const name of sharedFiles) {
    const source = await readFile(new URL(name, sharedRoot), 'utf8')
    const bundled = await readFile(new URL(name, sharedBundle), 'utf8')
    assert.equal(bundled, source, `${name} bundle should exactly mirror the tested shared implementation`)
  }
})

test('browsing a market does not silently mutate the shared bot pair', async () => {
  const app = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8')
  const panel = await readFile(new URL('../src/components/PaperBotPanel.tsx', import.meta.url), 'utf8')
  assert.match(app, /const selectPair=\(id:string\)=>setSelected\(id\)/)
  assert.doesNotMatch(app, /setPaperControl/)
  assert.match(panel, /setPaperControl\(action, value\)/)
})
