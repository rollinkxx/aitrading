export type KeysetPage<T> = {
  rows: T[];
  nextCursor: string | null;
  hasMore: boolean;
  truncated: boolean;
};

export function capRows<T>(rows: T[], limit: number): { rows: T[]; hasMore: boolean } {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
}

/**
 * Fetch a bounded, ascending keyset scan. The caller must request rows strictly
 * greater than `after` and order by the same unique key. A one-row lookahead
 * distinguishes a complete cap-sized result from a truncated result.
 */
export async function fetchKeysetPages<T extends Record<string, unknown>>(
  fetchPage: (after: string | null, limit: number) => Promise<T[]>,
  options: { pageSize: number; maxRows: number; deadlineAt: number; afterId?: string | null; now?: () => number; key?: keyof T },
): Promise<KeysetPage<T>> {
  const { pageSize, maxRows, deadlineAt } = options;
  const now = options.now ?? Date.now;
  const key = options.key ?? "id" as keyof T;
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error("pageSize must be a positive integer");
  if (!Number.isInteger(maxRows) || maxRows < 1) throw new Error("maxRows must be a positive integer");
  const rows: T[] = [];
  let cursor: string | null = options.afterId ?? null;
  while (rows.length < maxRows) {
    if (now() >= deadlineAt) return { rows, nextCursor: cursor, hasMore: true, truncated: true };
    let batch: T[];
    try {
      batch = await fetchPage(cursor, Math.min(pageSize, maxRows - rows.length + 1));
    } catch (error) {
      if (now() >= deadlineAt) return { rows, nextCursor: cursor, hasMore: true, truncated: true };
      throw error;
    }
    if (!Array.isArray(batch)) throw new Error("paged database response was not an array");
    if (!batch.length) return { rows, nextCursor: cursor, hasMore: false, truncated: false };
    const accepted = batch.slice(0, maxRows - rows.length);
    for (const row of accepted) {
      const value = row?.[key];
      if (typeof value !== "string" || (cursor !== null && value <= cursor)) throw new Error("keyset page keys must be non-empty, unique, and strictly increasing");
      cursor = value;
      rows.push(row);
    }
    if (batch.length > accepted.length) return { rows, nextCursor: cursor, hasMore: true, truncated: true };
    if (batch.length < Math.min(pageSize, maxRows - (rows.length - batch.length) + 1)) {
      return { rows, nextCursor: cursor, hasMore: false, truncated: false };
    }
  }
  if (now() >= deadlineAt) return { rows, nextCursor: cursor, hasMore: true, truncated: true };
  let lookahead: T[];
  try {
    lookahead = await fetchPage(cursor, 1);
  } catch (error) {
    if (now() >= deadlineAt) return { rows, nextCursor: cursor, hasMore: true, truncated: true };
    throw error;
  }
  if (!Array.isArray(lookahead)) throw new Error("paged database response was not an array");
  if (lookahead.length) {
    const value = lookahead[0]?.[key];
    if (typeof value !== "string" || (cursor !== null && value <= cursor)) {
      throw new Error("keyset lookahead key must be strictly greater than the cursor");
    }
    return { rows, nextCursor: cursor, hasMore: true, truncated: true };
  }
  return { rows, nextCursor: cursor, hasMore: false, truncated: false };
}

export async function fetchAllPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<T[]>,
  pageSize = 500,
  maxPages = 20,
): Promise<T[]> {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error("pageSize must be a positive integer");
  if (!Number.isInteger(maxPages) || maxPages < 1) throw new Error("maxPages must be a positive integer");
  const rows: T[] = [];
  for (let page = 0; page < maxPages; page++) {
    const batch = await fetchPage(page * pageSize, pageSize);
    if (!Array.isArray(batch)) throw new Error("paged database response was not an array");
    rows.push(...batch);
    if (batch.length < pageSize) return rows;
  }
  throw new Error(`paged database response exceeded ${maxPages * pageSize} rows`);
}
