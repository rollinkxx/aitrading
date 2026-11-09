import type { StoredSignal } from './indodax'

type SnapshotSignals = { signals: StoredSignal[] } | null

export type NotificationState = {
  initialized: boolean
  cursor: string
  persistCursor?: string
  notification?: StoredSignal
}

export function advanceNotificationState(
  snapshot: SnapshotSignals,
  watchlist: string[],
  initialized: boolean,
  currentCursor: string,
  savedCursor: string | null,
): NotificationState {
  if (!snapshot) return { initialized, cursor: currentCursor }
  const candidates = snapshot.signals
    .filter(signal => (signal.signal_type === 'BUY' || signal.signal_type === 'SELL')
      && signal.status === 'active'
      && (!signal.expires_at || new Date(signal.expires_at).getTime() > Date.now())
      && watchlist.includes(signal.market_id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
  const newest = candidates[0]

  if (!initialized) {
    if (!newest) {
      if (snapshot.signals.length === 0) return { initialized: true, cursor: savedCursor || currentCursor }
      return { initialized: false, cursor: savedCursor || currentCursor }
    }
    const baseline = savedCursor || currentCursor
    if (!baseline) return { initialized: true, cursor: newest.created_at, persistCursor: newest.created_at }
    if (newest.created_at > baseline) return { initialized: true, cursor: newest.created_at, persistCursor: newest.created_at, notification: newest }
    return { initialized: true, cursor: baseline }
  }

  const cursor = currentCursor || savedCursor || ''
  if (!newest || newest.created_at <= cursor) return { initialized: true, cursor }
  return { initialized: true, cursor: newest.created_at, persistCursor: newest.created_at, notification: newest }
}
