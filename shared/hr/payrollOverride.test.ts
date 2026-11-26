import test from "node:test";
import assert from "node:assert/strict";
import { computeSalary, overriddenGross, type ComponentDef, type StatutoryRules } from "./payroll";

const comps: ComponentDef[] = [
  { code: "BASIC", name: "Basic", calc: { type: "percent", of: "gross", bps: 5000 }, pfWage: true },
  { code: "SPL", name: "Special Allowance", calc: { type: "balance" } },
];
const rules: StatutoryRules = {
  pf: { enabled: true, employeeBps: 1200, employerBps: 1200, wageCeilingPaise: null },
  tds: { enabled: false, slabs: [], standardDeductionPaise: 0, cessBps: 0 },
  professionalTax: { enabled: false, monthlyPaise: 0 },
};

test("no override keeps the compensation gross", () => {
  assert.equal(overriddenGross(50_000_00, null), 50_000_00);
  assert.equal(overriddenGross(50_000_00, undefined), 50_000_00);
});

test("adjust adds a signed amount, set replaces", () => {
  assert.equal(overriddenGross(50_000_00, { kind: "adjust", amountPaise: 5_000_00 }), 55_000_00);
  assert.equal(overriddenGross(50_000_00, { kind: "adjust", amountPaise: -10_000_00 }), 40_000_00);
  assert.equal(overriddenGross(50_000_00, { kind: "set", amountPaise: 62_500_00 }), 62_500_00);
});

test("override cannot take gross to zero or below", () => {
  assert.throws(() => overriddenGross(10_000_00, { kind: "adjust", amountPaise: -10_000_00 }));
  assert.throws(() => overriddenGross(10_000_00, { kind: "set", amountPaise: 0 }));
  assert.throws(() => overriddenGross(10_000_00, { kind: "adjust", amountPaise: 1.5 }));
});

test("adjusted gross flows through components and PF", () => {
  const base = computeSalary({ monthlyGrossPaise: 50_000_00, components: comps, calendarDays: 31, paidDays: 31, rules });
  const up = computeSalary({ monthlyGrossPaise: overriddenGross(50_000_00, { kind: "adjust", amountPaise: 5_000_00 }), components: comps, calendarDays: 31, paidDays: 31, rules });
  assert.equal(up.grossPaidPaise - base.grossPaidPaise, 5_000_00);
  // Basic is half of gross, so PF (12% of Basic) rises by 12% of 2,500
  assert.equal(up.deductions[0].amount - base.deductions[0].amount, 300_00);
});
