import test from "node:test";
import assert from "node:assert/strict";
import { computeSalary, resolveComponents, prorate, annualTax, type ComponentDef, type StatutoryRules } from "./payroll";
import { amountInWords, formatINR, rupeesToPaise } from "./money";

const comps: ComponentDef[] = [
  { code: "BASIC", name: "Basic", calc: { type: "percent", of: "gross", bps: 5000 }, pfWage: true },
  { code: "HRA", name: "HRA", calc: { type: "percent", of: "BASIC", bps: 4000 } },
  { code: "SPL", name: "Special Allowance", calc: { type: "balance" } },
];
const off: StatutoryRules = {
  pf: { enabled: false, employeeBps: 1200, employerBps: 1200, wageCeilingPaise: null },
  tds: { enabled: false, slabs: [], standardDeductionPaise: 0, cessBps: 0 },
  professionalTax: { enabled: false, monthlyPaise: 0 },
};

test("components add up exactly to gross", () => {
  const lines = resolveComponents(rupeesToPaise(50000), comps);
  assert.deepEqual(lines.map((l) => l.amount), [2500000, 1000000, 1500000]);
  assert.equal(lines.reduce((s, l) => s + l.amount, 0), 5000000);
});

test("balance never negative / cycles rejected", () => {
  assert.throws(() => resolveComponents(100, [{ code: "A", name: "A", calc: { type: "fixed", amount: 500 } }, { code: "B", name: "B", calc: { type: "balance" } }]));
  assert.throws(() => resolveComponents(100, [
    { code: "A", name: "A", calc: { type: "percent", of: "B", bps: 100 } },
    { code: "B", name: "B", calc: { type: "percent", of: "A", bps: 100 } }]));
});

test("no PF, no deductions: net equals gross", () => {
  const r = computeSalary({ monthlyGrossPaise: 5000000, components: comps, calendarDays: 30, paidDays: 30, rules: off });
  assert.equal(r.netPayPaise, 5000000);
  assert.equal(r.deductions.length, 0);
});

test("loss of pay prorates every component and sums to paid gross", () => {
  const r = computeSalary({ monthlyGrossPaise: 5000000, components: comps, calendarDays: 30, paidDays: 27, rules: off });
  assert.equal(r.grossPaidPaise, r.earnings.reduce((s, l) => s + l.amount, 0));
  assert.ok(Math.abs(r.grossPaidPaise - 4500000) <= 2);
  assert.equal(prorate(1000, 15, 30), 500);
  assert.equal(prorate(1000, 14.5, 30), 483);
});

test("PF applies on PF wages with explicit ceiling; throws when ceiling undefined", () => {
  const rules: StatutoryRules = { ...off, pf: { enabled: true, employeeBps: 1200, employerBps: 1200, wageCeilingPaise: 1500000 } };
  const r = computeSalary({ monthlyGrossPaise: 5000000, components: comps, calendarDays: 30, paidDays: 30, rules });
  assert.equal(r.deductions[0].amount, 180000); // 12% of capped 15,000
  assert.equal(r.employerContributions[0].amount, 180000);
  const bad = { ...off, pf: { enabled: true, employeeBps: 1200, employerBps: 1200 } as any };
  assert.throws(() => computeSalary({ monthlyGrossPaise: 5000000, components: comps, calendarDays: 30, paidDays: 30, rules: bad }));
});

test("TDS uses supplied slabs only (test slabs, not real law)", () => {
  const tds = { enabled: true, standardDeductionPaise: 0, cessBps: 0,
    slabs: [{ upToPaise: 100000000, rateBps: 0 }, { upToPaise: null, rateBps: 1000 }] };
  assert.equal(annualTax(150000000, tds), 5000000);
  const r = computeSalary({ monthlyGrossPaise: 15000000 / 12 * 12 / 12 | 0, components: [{ code: "B", name: "B", calc: { type: "balance" } }],
    calendarDays: 30, paidDays: 30, rules: { ...off, tds }, tds: { taxDeductedSoFarPaise: 0, monthsRemaining: 12 } });
  assert.ok(r.netPayPaise <= r.grossPaidPaise);
});

test("INR formatting and words", () => {
  assert.equal(formatINR(123456789), "₹12,34,567.89");
  assert.equal(amountInWords(4500000), "Rupees Forty Five Thousand Only");
  assert.equal(amountInWords(1234500000), "Rupees One Crore Twenty Three Lakh Forty Five Thousand Only");
});
