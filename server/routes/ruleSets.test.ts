import { test } from "node:test";
import assert from "node:assert/strict";
import { RULE_PRESETS, isPresetRow, sameRules } from "../../shared/hr/presets";
import { eligibleRuleSets, runsUsingRuleSet } from "./payrollHelpers";

const std = RULE_PRESETS.find((p) => p.key === "in-2026-10")!;
const noPf = RULE_PRESETS.find((p) => p.key === "in-2026-10-nopf")!;
const allOff = { pf: { enabled: false, employeeBps: 0, employerBps: 0, wageCeilingPaise: null }, tds: { enabled: false, slabs: [], standardDeductionPaise: 0, cessBps: 0 }, professionalTax: { enabled: false, monthlyPaise: 0 } };

test("rules compare by value, not key order", () => {
  const flip = (v: unknown): unknown => Array.isArray(v) ? v.map(flip) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, flip(x)])) : v;
  assert.ok(sameRules(std.rules, flip(std.rules)));
  assert.ok(!sameRules(std.rules, noPf.rules));
});

test("a preset counts as added only when its values match, not just its date", () => {
  const row = { effectiveFrom: "2026-10-01", rules: std.rules };
  assert.ok(isPresetRow(std, row));
  assert.ok(!isPresetRow(noPf, row), "same date, different values");
});

test("eligible rule sets: effective by the month start, newest date then newest added", () => {
  const rows = [
    { id: "a", effectiveFrom: "2026-04-01", createdAt: "2026-11-01T00:00:00Z", rules: allOff },
    { id: "b", effectiveFrom: "2026-10-01", createdAt: "2026-11-02T00:00:00Z", rules: std.rules },
    { id: "c", effectiveFrom: "2026-10-01", createdAt: "2026-11-03T00:00:00Z", rules: noPf.rules },
    { id: "d", effectiveFrom: "2026-12-01", createdAt: "2026-11-04T00:00:00Z", rules: std.rules },
  ];
  assert.deepEqual(eligibleRuleSets(rows, "2026-11").map((r) => r.id), ["c", "b", "a"]);
  assert.deepEqual(eligibleRuleSets(rows, "2026-09").map((r) => r.id), ["a"]);
});

test("runs using a rule set: by id when recorded, else by date and values; imports never count", () => {
  const rule = { id: "r1", effectiveFrom: "2026-04-01", rules: allOff };
  const runs = [
    { month: "2026-09", status: "locked", rulesSnapshot: { ruleEffectiveFrom: "2026-04-01", rules: allOff } }, // older run, no id
    { month: "2026-10", status: "draft", rulesSnapshot: { ruleId: "r1", ruleEffectiveFrom: "2026-04-01", rules: allOff } },
    { month: "2026-11", status: "draft", rulesSnapshot: { ruleId: "r2", ruleEffectiveFrom: "2026-10-01", rules: std.rules } },
    { month: "2026-08", status: "locked", rulesSnapshot: { ruleEffectiveFrom: "2026-04-01", rules: std.rules } }, // same date, other values
    { month: "2026-07", status: "paid", rulesSnapshot: { imported: true, exceptions: [] } },
  ];
  assert.deepEqual(runsUsingRuleSet(rule, runs).map((r) => r.month), ["2026-09", "2026-10"]);
});
