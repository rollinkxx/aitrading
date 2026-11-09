import test from "node:test";
import assert from "node:assert/strict";
import { evaluateOutcome, freshPrice, fullCollectorOwnsThisMinute } from "../supabase/functions/signal-checker/core.ts";

const now = 1_800_000_000_000;
const ticker = (last, ageMs = 0) => ({ last, server_time: (now - ageMs) / 1000 });
const signal = (overrides = {}) => ({
  id: "signal-1",
  market_id: "btcidr",
  signal_type: "BUY",
  reference_price: 100,
  stop_loss: 95,
  take_profit: 110,
  ...overrides,
});

test("defers to the full collector only at UTC five-minute boundaries", () => {
  assert.equal(fullCollectorOwnsThisMinute(Date.UTC(2026, 10, 7, 11, 20)), true);
  assert.equal(fullCollectorOwnsThisMinute(Date.UTC(2026, 10, 7, 11, 21)), false);
});

test("ignores stale or implausibly future ticker timestamps", () => {
  assert.equal(freshPrice(ticker(110, 91_000), now), null);
  assert.equal(freshPrice({ last: 110, server_time: (now + 61_000) / 1000 }, now), null);
});

test("detects a BUY take-profit and calculates long return", () => {
  assert.deepEqual(evaluateOutcome(signal(), ticker(112), now), {
    signalId: "signal-1",
    exitPrice: 112,
    returnPercentage: 12,
    outcome: "take_profit",
  });
});

test("detects a BUY stop-loss", () => {
  assert.equal(evaluateOutcome(signal(), ticker(94), now)?.outcome, "stop_loss");
});

test("detects a SELL take-profit and calculates short return", () => {
  const result = evaluateOutcome(signal({ signal_type: "SELL", stop_loss: 105, take_profit: 90 }), ticker(88), now);
  assert.equal(result?.outcome, "take_profit");
  assert.equal(result?.returnPercentage, 12);
});

test("detects a SELL stop-loss and rejects prices that hit neither level", () => {
  assert.equal(evaluateOutcome(signal({ signal_type: "SELL", stop_loss: 105, take_profit: 90 }), ticker(106), now)?.outcome, "stop_loss");
  assert.equal(evaluateOutcome(signal(), ticker(101), now), null);
});

test("does not evaluate non-directional or malformed signals", () => {
  assert.equal(evaluateOutcome(signal({ signal_type: "HOLD" }), ticker(120), now), null);
  assert.equal(evaluateOutcome(signal({ reference_price: 0 }), ticker(120), now), null);
});

test("accepts fresh-price boundaries in seconds and milliseconds and rejects values just outside them", () => {
  assert.equal(freshPrice({ last: "110", server_time: (now - 90_000) / 1000 }, now), 110);
  assert.equal(freshPrice({ last: 110, server_time: now - 90_000 }, now), 110);
  assert.equal(freshPrice({ last: 110, server_time: now + 60_000 }, now), 110);
  assert.equal(freshPrice({ last: 110, server_time: now - 90_001 }, now), null);
  assert.equal(freshPrice({ last: 110, server_time: (now + 60_001) / 1000 }, now), null);
});

test("rejects absent, non-finite, or non-positive ticker prices and timestamps", () => {
  for (const invalid of [
    null,
    undefined,
    {},
    { last: 0, server_time: now },
    { last: -1, server_time: now },
    { last: "not-a-price", server_time: now },
    { last: 110, server_time: 0 },
    { last: 110, server_time: "not-a-time" },
  ]) {
    assert.equal(freshPrice(invalid, now), null);
  }
});

test("rejects malformed stop, target, and reference values before outcome evaluation", () => {
  for (const overrides of [
    { reference_price: "not-a-price" },
    { stop_loss: null },
    { stop_loss: "not-a-price" },
    { take_profit: "not-a-price" },
  ]) {
    assert.equal(evaluateOutcome(signal(overrides), ticker(112), now), null);
  }
});

test("uses stop-loss precedence when a malformed signal range makes both levels true", () => {
  assert.equal(evaluateOutcome(signal({ stop_loss: 115, take_profit: 110 }), ticker(112), now)?.outcome, "stop_loss");
  assert.equal(
    evaluateOutcome(signal({ signal_type: "SELL", stop_loss: 90, take_profit: 100 }), ticker(95), now)?.outcome,
    "stop_loss",
  );
});
