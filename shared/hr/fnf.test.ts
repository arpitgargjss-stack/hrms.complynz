import { test } from "node:test";
import assert from "node:assert/strict";
import { FNF_DEFAULTS, computeFnf, payBy, service } from "./fnf";

const base = { monthlyGrossPaise: 45_000_00, monthlyBasicPaise: 22_500_00, joiningDate: "2024-01-15", lastWorkingDay: "2026-11-30", unpaidDays: 30, calendarDays: 30, encashableLeaveDays: 10, noticeRequiredDays: 30, noticeServedDays: 30, waiveNotice: false, extraEarnings: [], deductions: [] };

test("salary for unpaid days, leave encashment on basic / 30", () => {
  const r = computeFnf(base);
  assert.equal(r.earnings[0].amountPaise, 45_000_00);
  assert.equal(r.earnings[1].amountPaise, 7_500_00); // 22,500 / 30 x 10
  assert.equal(r.netPaise, 52_500_00);
});
test("leave encashment is capped and notice shortfall is recovered unless waived", () => {
  const r = computeFnf({ ...base, encashableLeaveDays: 45, noticeServedDays: 20 });
  assert.equal(r.earnings[1].amountPaise, 22_500_00);
  assert.equal(r.deductions[0].amountPaise, 7_500_00);
  assert.equal(computeFnf({ ...base, noticeServedDays: 0, waiveNotice: true }).deductions.length, 0);
});
test("gratuity only after 5 years, part year over 6 months rounds up, and only when switched on", () => {
  const long = { ...base, joiningDate: "2019-01-01", lastWorkingDay: "2026-08-15" }; // 7 years 7 months -> 8
  assert.equal(service(long.joiningDate, long.lastWorkingDay).years, 7);
  assert.equal(computeFnf(long).earnings.find((l) => l.label === "Gratuity"), undefined);
  const g = computeFnf(long, { ...FNF_DEFAULTS, gratuity: { ...FNF_DEFAULTS.gratuity, enabled: true } }).earnings.find((l) => l.label === "Gratuity")!;
  assert.equal(g.amountPaise, Math.round((22_500_00 * 15 * 8) / 26));
  assert.equal(computeFnf(base, { ...FNF_DEFAULTS, gratuity: { ...FNF_DEFAULTS.gratuity, enabled: true } }).earnings.find((l) => l.label === "Gratuity"), undefined);
});
test("payment due two working days after the last day, skipping Sunday", () => {
  assert.equal(payBy("2026-11-28", 2), "2026-12-01"); // Saturday -> Monday, Tuesday
});
