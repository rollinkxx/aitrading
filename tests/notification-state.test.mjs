import test from 'node:test'
import assert from 'node:assert/strict'
import { advanceNotificationState } from '../src/lib/notification-state.ts'

const signal = (created_at, overrides = {}) => ({
  id: `id-${created_at}`, market_id: 'btcidr', signal_type: 'BUY', status: 'active',
  created_at, expires_at: new Date(Date.now() + 60_000).toISOString(), reason_text: 'valid signal', confidence: 80,
  timeframe: '15m/1h/4h', reference_price: 100, entry_low: 99, entry_high: 101, stop_loss: 95,
  take_profit: 110, risk_reward: 2, data_quality: 'validated', ...overrides,
})

test('a successful empty initial snapshot initializes without writing an empty cursor; next signal notifies', () => {
  const empty = advanceNotificationState({ signals: [] }, ['btcidr'], false, '', null)
  assert.deepEqual(empty, { initialized: true, cursor: '' })
  const next = advanceNotificationState({ signals: [signal('2026-11-09T12:00:00.000Z')] }, ['btcidr'], empty.initialized, empty.cursor, null)
  assert.equal(next.notification?.signal_type, 'BUY')
  assert.equal(next.persistCursor, '2026-11-09T12:00:00.000Z')
})

test('failed snapshot leaves notification initialization and cursor untouched', () => {
  assert.deepEqual(advanceNotificationState(null, ['btcidr'], false, '', null), { initialized: false, cursor: '' })
})

test('first populated snapshot without a saved cursor establishes a baseline without alerting backlog', () => {
  const result = advanceNotificationState({ signals: [signal('2026-11-09T12:00:00.000Z')] }, ['btcidr'], false, '', null)
  assert.equal(result.initialized, true)
  assert.equal(result.notification, undefined)
  assert.equal(result.cursor, '2026-11-09T12:00:00.000Z')
})

test('stored cursor is preserved across an empty snapshot and only newer signals notify', () => {
  const empty = advanceNotificationState({ signals: [] }, ['btcidr'], false, '', '2026-11-09T11:00:00.000Z')
  assert.equal(empty.cursor, '2026-11-09T11:00:00.000Z')
  const old = advanceNotificationState({ signals: [signal('2026-11-09T10:00:00.000Z')] }, ['btcidr'], empty.initialized, empty.cursor, empty.cursor)
  assert.equal(old.notification, undefined)
  const newer = advanceNotificationState({ signals: [signal('2026-11-09T12:00:00.000Z')] }, ['btcidr'], old.initialized, old.cursor, old.cursor)
  assert.equal(newer.notification?.created_at, '2026-11-09T12:00:00.000Z')
})

test('non-empty snapshot without a watchlist candidate does not initialize the baseline', () => {
  const result = advanceNotificationState({ signals: [signal('2026-11-09T12:00:00.000Z')] }, ['ethidr'], false, '', null)
  assert.equal(result.initialized, false)
})
