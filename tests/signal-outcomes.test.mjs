import test from "node:test";
import assert from "node:assert/strict";
import { persistSignalOutcomes } from "../supabase/functions/_shared/signal-outcomes.ts";

const outcome = (signal_id, exit_price = 110) => ({
  signal_id,
  exit_price,
  return_percentage: 10,
  outcome: "take_profit",
  closed_at: "2026-11-07T12:00:00.000Z",
});

test("persists each signal outcome once before closing active signals", async () => {
  const calls = [];
  const count = await persistSignalOutcomes(
    [outcome("signal-a", 110), outcome("signal-a", 111), outcome("signal-b", 90)],
    async rows => calls.push(["insert", rows.map(row => row.signal_id)]),
    async ids => calls.push(["close", ids]),
  );

  assert.equal(count, 2);
  assert.deepEqual(calls, [
    ["insert", ["signal-a", "signal-b"]],
    ["close", ["signal-a", "signal-b"]],
  ]);
});

test("does not close signals when outcome persistence fails", async () => {
  let closeCalled = false;

  await assert.rejects(
    persistSignalOutcomes(
      [outcome("signal-a")],
      async () => { throw new Error("database unavailable"); },
      async () => { closeCalled = true; },
    ),
    /database unavailable/,
  );
  assert.equal(closeCalled, false);
});

test("does not issue database writes for an empty outcome batch", async () => {
  let writes = 0;
  const count = await persistSignalOutcomes([], async () => { writes++; }, async () => { writes++; });
  assert.equal(count, 0);
  assert.equal(writes, 0);
});
