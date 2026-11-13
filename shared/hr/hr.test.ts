import test from "node:test";
import assert from "node:assert/strict";
import { isWorkingDay, leaveDaysX2, entitlementX2, paidDaysX2, type CalendarSettings } from "./leave";
import { checkClaim, type ReimbPolicy } from "./reimbursement";
import { buildAdvice, toCsv } from "./bankAdvice";
import { nextEmployeeCode, letterRef, upcomingEvents, shouldShowResults } from "./misc";

const cal: CalendarSettings = { weeklyOff: [0], saturdays: { mode: "alternate", offWeeks: [2, 4] }, workStart: "10:00", workEnd: "18:30" };

test("calendar: Sunday off, alternate Saturdays, holidays", () => {
  assert.equal(isWorkingDay("2026-11-15", cal, []), false); // Sunday
  assert.equal(isWorkingDay("2026-11-07", cal, []), true); // 1st Saturday working
  assert.equal(isWorkingDay("2026-11-14", cal, []), false); // 2nd Saturday off
  assert.equal(isWorkingDay("2026-11-12", cal, [{ date: "2026-11-12" }]), false);
  assert.equal(isWorkingDay("2026-11-12", cal, [{ date: "2026-11-12", optional: true }]), true);
});
test("leave days skip weekends and holidays; half day counts 1", () => {
  assert.equal(leaveDaysX2("2026-11-09", "2026-11-13", false, cal, []), 10);
  assert.equal(leaveDaysX2("2026-11-09", "2026-11-15", false, cal, [{ date: "2026-11-11" }]), 8);
  assert.equal(leaveDaysX2("2026-11-09", "2026-11-09", true, cal, []), 1);
  assert.throws(() => leaveDaysX2("2026-11-09", "2026-11-10", true, cal, []));
});
test("entitlement prorates by joining month for monthly accrual", () => {
  const t = { annualQuotaHalfDays: 24, carryForwardHalfDays: 0, accrual: "monthly" as const };
  assert.equal(entitlementX2(t, "2026-06-30", "2020-01-01"), 12);
  assert.equal(entitlementX2(t, "2026-06-30", "2026-04-10"), 6);
  assert.equal(paidDaysX2(30, 4), 56);
});
const pol: ReimbPolicy = { ratePerKmPaise: { self_car: 1000, two_wheeler: 500 }, billRequiredAbovePaise: 50000, managerApprovalAbovePaise: 500000, ceoApprovalAbovePaise: 1000000, submitWithinDays: 7 };
test("reimbursement: rate check, bill rule, approver tier, lateness", () => {
  const base = { category: "travel" as const, mode: "self_car", distanceKm: 20, amountPaise: 20000, hasBill: false, expenseDate: "2026-10-05", submittedOn: "2026-11-03", month: "2026-10" };
  assert.equal(checkClaim(base, pol).flags.length, 0);
  assert.equal(checkClaim({ ...base, amountPaise: 25000 }, pol).flags[0].code, "rate_mismatch");
  assert.ok(checkClaim({ category: "expense", amountPaise: 60000, hasBill: false, expenseDate: "2026-10-05", submittedOn: "2026-10-06", month: "2026-10" }, pol).flags.some((f) => f.code === "bill_required"));
  assert.equal(checkClaim({ category: "expense", amountPaise: 600000, hasBill: true, expenseDate: "2026-10-05", submittedOn: "2026-10-06", month: "2026-10" }, pol).approver, "manager");
  assert.equal(checkClaim({ category: "expense", amountPaise: 1100000, hasBill: true, expenseDate: "2026-10-05", submittedOn: "2026-10-06", month: "2026-10" }, pol).approver, "ceo");
  assert.ok(checkClaim({ ...base, submittedOn: "2026-11-20" }, pol).flags.some((f) => f.code === "late"));
});
test("bank advice validates, totals, neutralises csv formulas", () => {
  const bad = buildAdvice({ month: "2026-10", refNo: "R1", rows: [{ name: "A", bankName: "B", accountNo: "123", ifsc: "X", amountPaise: 1 }] });
  assert.equal(bad.ok, false);
  const ok = buildAdvice({ month: "2026-10", refNo: "R1", rows: [
    { name: "Zed", bankName: "HDFC", accountNo: "123456789012", ifsc: "HDFC0001234", amountPaise: 100000 },
    { name: "=cmd", bankName: "HDFC", accountNo: "123456789013", ifsc: "HDFC0001234", amountPaise: 50000 }] });
  assert.ok(ok.ok); if (ok.ok) { assert.equal(ok.totalPaise, 150000); assert.equal(ok.rows[0].srNo, 1); assert.ok(toCsv(ok.rows).includes("\"'=cmd\"")); }
});
test("codes, refs, events, anonymity threshold", () => {
  assert.equal(nextEmployeeCode(["CMPZ001", "CMPZ009"]), "CMPZ010");
  assert.equal(letterRef(2026, 7), "CMPZ/HR/2026/0007");
  const ev = upcomingEvents("2026-11-13", [
    { id: "1", name: "A", dob: "1990-11-20", joiningDate: "2022-11-18", birthdayOptIn: true },
    { id: "2", name: "B", dob: "1990-11-21", joiningDate: "2026-11-01", birthdayOptIn: false }]);
  assert.deepEqual(ev.map((e) => e.kind + e.id), ["anniversary1", "birthday1"]);
  assert.equal(shouldShowResults(4), false); assert.equal(shouldShowResults(5), true);
});
