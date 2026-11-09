import test from "node:test";
import assert from "node:assert/strict";
import { fetchAllPages } from "../supabase/functions/_shared/pagination.ts";

test("fetchAllPages concatenates pages and stops at a short page", async () => {
  const calls = [];
  const rows = await fetchAllPages(async (offset, limit) => {
    calls.push([offset, limit]);
    return offset === 0 ? [1, 2] : [3];
  }, 2);
  assert.deepEqual(rows, [1, 2, 3]);
  assert.deepEqual(calls, [[0, 2], [2, 2]]);
});

test("fetchAllPages rejects malformed page responses", async () => {
  await assert.rejects(fetchAllPages(async () => null), /not an array/);
});

test("fetchAllPages fails closed when the maximum page bound is reached", async () => {
  await assert.rejects(fetchAllPages(async () => [1], 1, 2), /exceeded 2 rows/);
});

test("fetchAllPages rejects invalid page size and page bounds before making requests", async () => {
  let requests = 0;
  const fetchPage = async () => { requests++; return []; };

  await assert.rejects(fetchAllPages(fetchPage, 0, 2), /pageSize must be a positive integer/);
  await assert.rejects(fetchAllPages(fetchPage, 1.5, 2), /pageSize must be a positive integer/);
  await assert.rejects(fetchAllPages(fetchPage, 1, 0), /maxPages must be a positive integer/);
  await assert.rejects(fetchAllPages(fetchPage, 1, 1.5), /maxPages must be a positive integer/);
  assert.equal(requests, 0);
});
