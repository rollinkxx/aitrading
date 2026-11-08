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
