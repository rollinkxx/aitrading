const DEFAULT_WATCHLIST = ['btcidr', 'ethidr', 'solidr']

function readValue(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeValue(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    // Persistence is best-effort; the in-memory React state remains usable.
  }
}

export function readWatchlist(): string[] {
  const raw = readValue('aitrading-watchlist')
  if (raw === null) return [...DEFAULT_WATCHLIST]
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return [...DEFAULT_WATCHLIST]
    const ids = value.filter((item): item is string =>
      typeof item === 'string' && /^[a-z0-9]+idr$/.test(item),
    )
    return [...new Set(ids)]
  } catch {
    return [...DEFAULT_WATCHLIST]
  }
}

export function readNotificationsEnabled(): boolean {
  return readValue('aitrading-notifications') === 'on'
}

export function readNotificationCursor(): string | null {
  return readValue('aitrading-notification-cursor')
}

export function persistWatchlist(value: string[]): void {
  writeValue('aitrading-watchlist', JSON.stringify(value))
}

export function persistNotificationsEnabled(enabled: boolean): void {
  writeValue('aitrading-notifications', enabled ? 'on' : 'off')
}

export function persistNotificationCursor(value: string): void {
  writeValue('aitrading-notification-cursor', value)
}
