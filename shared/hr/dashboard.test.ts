import { test } from "node:test";
import assert from "node:assert/strict";
import { attritionPct, lastMonths, median, suppressSmall } from "./dashboard";

test("last months wrap across the year", () => {
  assert.deepEqual(lastMonths(3, "2026-02-10"), ["2025-12", "2026-01", "2026-02"]);
});
test("attrition is annualised over the window", () => {
  assert.equal(attritionPct(3, [10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]), 30);
  assert.equal(attritionPct(1, [10, 10, 10, 10, 10, 10]), 20);
  assert.equal(attritionPct(1, []), null);
});
test("groups under five are merged so no one can be singled out", () => {
  assert.deepEqual(suppressSmall({ a: 6, b: 2, c: 1 }), [{ key: "a", count: 6 }, { key: "_small", count: 3 }]);
});
test("median", () => { assert.equal(median([3, 1, 2]), 2); assert.equal(median([1, 2, 3, 4]), 3); assert.equal(median([]), 0); });

test("date range presets and buckets", async () => {
  const { resolveRange, rangeBuckets, bucketOf, monthsIn, attritionOver } = await import("./dashboard");
  const today = "2026-11-21";
  assert.deepEqual(resolveRange({ range: "7d" }, today), { preset: "7d", from: "2026-11-15", to: today });
  assert.deepEqual(resolveRange({ range: "30d" }, today).from, "2026-10-23");
  assert.deepEqual(resolveRange({ range: "fy" }, today).from, "2026-04-01");
  assert.deepEqual(resolveRange({ range: "fy" }, "2027-02-10").from, "2026-04-01");
  assert.deepEqual(resolveRange({}, today), { preset: "12m", from: "2025-12-01", to: today });
  assert.deepEqual(resolveRange({ range: "custom", from: "2026-12-31", to: "2026-10-01" }, today), { preset: "custom", from: "2026-10-01", to: today });
  assert.equal(resolveRange({ range: "custom", from: "bad", to: "2026-10-01" }, today).preset, "12m");
  const d = rangeBuckets("2026-11-15", today); assert.equal(d.grain, "day"); assert.equal(d.buckets.length, 7);
  const w = rangeBuckets("2026-08-24", today); assert.equal(w.grain, "week"); assert.equal(w.buckets[0].from, "2026-08-24");
  assert.equal(bucketOf(w.buckets, "2026-08-26"), "2026-08-24");
  const m = rangeBuckets("2025-12-01", today); assert.equal(m.grain, "month"); assert.equal(m.buckets.length, 12); assert.equal(m.buckets.at(-1)!.to, today);
  assert.deepEqual(monthsIn("2026-10-23", today), ["2026-10", "2026-11"]);
  assert.equal(attritionOver(2, 20, 365), 10);
});
