import { test } from "node:test";
import assert from "node:assert/strict";
import { RULE_PRESETS, TEMPLATE_PRESETS } from "../../shared/hr/presets";
import { computeSalary, resolveComponents } from "../../shared/hr/payroll";
import { componentsSchema, rulesSchema } from "./payrollHelpers";

const rules = RULE_PRESETS[0].rules;
const tpl = (k: string) => TEMPLATE_PRESETS.find((t) => t.key === k)!.components;
const run = (grossRupees: number, state: string | null, gender = "male", month = "2026-11", key = "standard") => computeSalary({
  monthlyGrossPaise: grossRupees * 100, components: tpl(key), calendarDays: 30, paidDays: 30, rules,
  pt: { state, gender, month }, tds: { taxDeductedSoFarPaise: 0, monthsRemaining: 5 },
});
const line = (r: ReturnType<typeof run>, code: string) => [...r.deductions, ...r.employerContributions].find((l) => l.code === code)?.amount ?? 0;

test("every preset passes the same validation as a hand-made rule set or template", () => {
  for (const p of RULE_PRESETS) { assert.ok(rulesSchema.safeParse(p.rules).success, p.key); assert.ok(p.source.length >= 5 && p.source.length <= 500, p.key); }
  for (const t of TEMPLATE_PRESETS) { assert.ok(componentsSchema.safeParse(t.components).success, t.key); resolveComponents(50_000_00, t.components); }
});

test("standard template keeps basic at half of gross", () => {
  const lines = resolveComponents(80_000_00, tpl("standard"));
  assert.equal(lines.find((l) => l.code === "BASIC")!.amount, 40_000_00);
  assert.equal(lines.reduce((s, l) => s + l.amount, 0), 80_000_00);
});

test("PF is 12% of basic, capped at the ₹25,000 ceiling", () => {
  assert.equal(line(run(30_000, null), "PF_EE"), 1_800_00); // basic 15,000
  assert.equal(line(run(80_000, null), "PF_EE"), 3_000_00); // basic 40,000, capped at 25,000
  assert.equal(line(run(80_000, null), "PF_ER"), 3_000_00);
});

test("ESI applies only up to ₹21,000 gross and rounds up to the rupee", () => {
  assert.equal(line(run(20_000, null), "ESI_EE"), 150_00);
  assert.equal(line(run(20_000, null), "ESI_ER"), 650_00);
  assert.equal(line(run(21_001, null), "ESI_EE"), 0);
});

test("professional tax follows the work-location state, gender and February", () => {
  assert.equal(line(run(50_000, "Maharashtra"), "PT"), 200_00);
  assert.equal(line(run(50_000, "Maharashtra", "male", "2027-02"), "PT"), 300_00);
  assert.equal(line(run(20_000, "Maharashtra", "female"), "PT"), 0);
  assert.equal(line(run(9_000, "Maharashtra"), "PT"), 175_00);
  assert.equal(line(run(50_000, "Uttar Pradesh"), "PT"), 0);
});

test("income up to ₹12 lakh after standard deduction pays no tax under the new regime", () => {
  // 1,00,000 x 12 = 12 lakh gross; 11.25 lakh after standard deduction: rebate makes it nil.
  assert.equal(computeSalary({ monthlyGrossPaise: 1_00_000_00, components: tpl("standard"), calendarDays: 30, paidDays: 30, rules, tds: { taxDeductedSoFarPaise: 0, monthsRemaining: 12 } }).deductions.find((d) => d.code === "TDS"), undefined);
});

test("the under-20 preset leaves PF out but keeps ESI and PT", () => {
  const nopf = RULE_PRESETS.find((p) => p.key === "in-2026-10-nopf")!.rules;
  const r = computeSalary({ monthlyGrossPaise: 20_000_00, components: tpl("standard"), calendarDays: 30, paidDays: 30, rules: nopf, pt: { state: "Maharashtra", gender: "male", month: "2026-11" }, tds: { taxDeductedSoFarPaise: 0, monthsRemaining: 5 } });
  assert.equal(line(r, "PF_EE"), 0);
  assert.equal(line(r, "ESI_EE"), 150_00);
  assert.equal(line(r, "PT"), 200_00);
});

test("Complynz standard matches the offer letter split", () => {
  const lines = resolveComponents(45_000_00, tpl("standard"));
  assert.deepEqual(lines.map((l) => [l.code, l.amount]), [["BASIC", 22_500_00], ["HRA", 9_000_00], ["SPECIAL", 13_500_00]]);
});
