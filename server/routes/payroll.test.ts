import test from "node:test";
import assert from "node:assert/strict";
import { fyStartMonth, monthsRemainingInFy, priorMonthsInFy, sumTdsYtd, employmentWindow, employmentGapX2, lossOfPayX2, esc, rulesSchema, nextAdviceRef, maskAccount, monthDays } from "./payrollHelpers";
import { aggregateClaims, approverTier, lastMonths, nextApprovalStatus } from "./reimbursementHelpers";

test("FY months remaining", () => {
  assert.equal(monthsRemainingInFy("2026-04"), 12);
  assert.equal(monthsRemainingInFy("2026-12"), 4);
  assert.equal(monthsRemainingInFy("2027-01"), 3);
  assert.equal(monthsRemainingInFy("2027-03"), 1);
  assert.equal(fyStartMonth("2027-02"), "2026-04");
  assert.equal(fyStartMonth("2026-04"), "2026-04");
});
test("prior months in FY", () => {
  assert.deepEqual(priorMonthsInFy("2026-04"), []);
  assert.deepEqual(priorMonthsInFy("2027-02"), ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01"]);
});
test("TDS YTD sum only counts TDS lines", () => {
  const a = { deductions: [{ code: "TDS", amount: 500 }, { code: "PF_EE", amount: 900 }] };
  const b = { deductions: [{ code: "TDS", amount: 250 }] };
  assert.equal(sumTdsYtd([a, b, {}, null]), 750);
});
test("employment window and gaps", () => {
  const w = employmentWindow("2026-02", "2026-02-10", null);
  assert.deepEqual(w, { start: "2026-02-10", end: "2026-02-28" });
  assert.equal(employmentGapX2("2026-02", w), 18);
  const x = employmentWindow("2026-02", "2020-01-01", "2026-02-20");
  assert.equal(employmentGapX2("2026-02", x), 16);
  assert.equal(monthDays("2028-02"), 29);
});
test("loss of pay: inside, half day, spanning needs calendar", () => {
  const w = employmentWindow("2026-03", "2020-01-01", null);
  assert.equal(lossOfPayX2([{ fromDate: "2026-03-10", toDate: "2026-03-11", halfDay: false, days2: 4 }, { fromDate: "2026-03-20", toDate: "2026-03-20", halfDay: true, days2: 1 }], w, null, []), 5);
  assert.throws(() => lossOfPayX2([{ fromDate: "2026-02-27", toDate: "2026-03-03", halfDay: false, days2: 6 }], w, null, []));
  const cal = { weeklyOff: [0], saturdays: { mode: "all_working" as const }, workStart: "09:00", workEnd: "18:00" };
  // 1 Mar 2026 is Sunday, 2 and 3 are working: clipped to Mar 1-3 = 2 working days = 4 half-days
  assert.equal(lossOfPayX2([{ fromDate: "2026-02-27", toDate: "2026-03-03", halfDay: false, days2: 6 }], w, cal, []), 4);
});
test("html escaping and masking", () => {
  assert.equal(esc(`<script>"x"&'`), "&lt;script&gt;&quot;x&quot;&amp;&#39;");
  assert.equal(maskAccount("123456789012"), "********9012");
});
test("rules schema demands every value and valid slabs", () => {
  const ok = { pf: { enabled: false, employeeBps: 0, employerBps: 0, wageCeilingPaise: null }, tds: { enabled: true, slabs: [{ upToPaise: 100, rateBps: 0 }, { upToPaise: null, rateBps: 500 }], standardDeductionPaise: 0, cessBps: 0 }, professionalTax: { enabled: false, monthlyPaise: 0 } };
  assert.ok(rulesSchema.safeParse(ok).success);
  assert.ok(!rulesSchema.safeParse({ ...ok, pf: { enabled: true, employeeBps: 1, employerBps: 1 } }).success);
  assert.ok(!rulesSchema.safeParse({ ...ok, tds: { ...ok.tds, slabs: [{ upToPaise: 100, rateBps: 0 }] } }).success);
  assert.ok(!rulesSchema.safeParse({ ...ok, tds: { ...ok.tds, slabs: [{ upToPaise: 200, rateBps: 0 }, { upToPaise: 100, rateBps: 1 }, { upToPaise: null, rateBps: 2 }] } }).success);
});
test("advice ref numbering", () => {
  assert.equal(nextAdviceRef("2026-10", []), "BA/2026-10/1");
  assert.equal(nextAdviceRef("2026-10", ["BA/2026-10/1", "BA/2026-10/3", "BA/2026-09/9"]), "BA/2026-10/4");
});
test("approval tiers and state machine", () => {
  const p = { managerApprovalAbovePaise: 200000, ceoApprovalAbovePaise: 1000000 };
  assert.equal(approverTier(200000, p), "finance");
  assert.equal(approverTier(200001, p), "manager");
  assert.equal(approverTier(1000001, p), "ceo");
  assert.equal(nextApprovalStatus("verified", "finance", "finance"), "approved");
  assert.equal(nextApprovalStatus("verified", "finance", "manager"), null);
  assert.equal(nextApprovalStatus("verified", "manager", "finance"), null);
  assert.equal(nextApprovalStatus("verified", "manager", "manager"), "approved");
  assert.equal(nextApprovalStatus("verified", "ceo", "manager"), "manager_approved");
  assert.equal(nextApprovalStatus("manager_approved", "ceo", "hr_admin"), "approved");
  assert.equal(nextApprovalStatus("submitted", "finance", "finance"), null);
});
test("analytics aggregation", () => {
  assert.deepEqual(lastMonths("2026-02", 3), ["2025-12", "2026-01", "2026-02"]);
  const months = lastMonths("2026-02", 3);
  const a = aggregateClaims([
    { month: "2026-01", category: "travel", mode: "two_wheeler", amountPaise: 100, status: "paid", department: "Eng" },
    { month: "2026-02", category: "expense", mode: null, amountPaise: 300, status: "submitted", department: null },
    { month: "2026-02", category: "travel", mode: "two_wheeler", amountPaise: 50, status: "rejected", department: "Eng" },
    { month: "2025-01", category: "travel", mode: null, amountPaise: 999, status: "paid", department: "Eng" },
  ], months);
  assert.deepEqual(a.trend.map((t) => t.totalPaise), [0, 100, 300]);
  assert.equal(a.totalPaise, 400);
  assert.deepEqual(a.byDepartment.map((b) => b.key), ["Unassigned", "Eng"]);
  assert.equal(a.byMode.find((b) => b.key === "not specified")?.totalPaise, 300);
});
