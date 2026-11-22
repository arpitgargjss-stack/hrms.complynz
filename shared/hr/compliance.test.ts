import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FACTS, ITEMS, SEGMENTS, defaultPriority, segmentOf, nextDue, prevDue, periodOf, type CompanyFacts } from "./compliance";

const facts = (o: Partial<CompanyFacts> = {}): CompanyFacts => ({ ...DEFAULT_FACTS, headcount: 8, interns: 3, states: ["Uttar Pradesh", "Maharashtra"], ...o });
const item = (k: string) => ITEMS.find((i) => i.key === k)!;
const need = (k: string, f: CompanyFacts) => item(k).applies(f).need;

test("every item has a unique key and a reason", () => {
  assert.equal(new Set(ITEMS.map((i) => i.key)).size, ITEMS.length);
  for (const i of ITEMS) assert.ok(i.applies(facts()).why.length > 3, i.key);
});

test("thresholds move with headcount and interns", () => {
  assert.equal(need("epf_ecr", facts()), "Not applicable");
  assert.equal(need("epf_ecr", facts({ headcount: 20 })), "Mandatory");
  assert.equal(need("epf_ecr", facts({ headcount: 17, interns: 10 })), "Not applicable"); // interns do not count for EPF
  assert.equal(need("posh_ic", facts()), "Mandatory"); // 8 + 3 interns = 11
  assert.equal(need("posh_ic", facts({ interns: 0 })), "Optional");
  assert.equal(need("esi_monthly", facts({ headcount: 9, interns: 0 })), "Not applicable");
});

test("state items follow the office states", () => {
  assert.equal(need("pt_mh", facts()), "Mandatory");
  assert.equal(need("pt_mh", facts({ states: ["Uttar Pradesh"] })), "Not applicable");
  assert.equal(need("mlwf", facts({ states: ["Maharashtra"], headcount: 4, interns: 0 })), "Not applicable");
});

test("profile flags switch foreign investment and MSME items", () => {
  assert.equal(need("fla", facts()), "Mandatory");
  assert.equal(need("fla", facts({ foreignInvestment: false })), "Not applicable");
  assert.equal(need("msme1", facts({ msmeVendors: false })), "Not applicable");
});

test("due dates roll forward and back", () => {
  assert.equal(nextDue(item("tds_salary"), "2026-11-21"), "2026-12-07");
  assert.equal(prevDue(item("tds_salary"), "2026-11-21"), "2026-11-07");
  assert.equal(nextDue(item("tds_24q"), "2026-11-21"), "2027-01-31");
  assert.equal(prevDue(item("tds_24q"), "2026-11-21"), "2026-10-31");
  assert.equal(nextDue(item("tds_salary"), "2026-12-25"), "2027-01-07");
  assert.equal(prevDue(item("tds_salary"), "2027-01-03"), "2026-12-07");
  assert.equal(periodOf(item("tds_salary"), "2026-12-07"), "2026-12");
});

test("default priority follows need, status and due date", () => {
  const T = "2026-11-22";
  const p = (need: string, status: string, due: string | null = null, trigger: "headcount" | null = null) => defaultPriority({ need, status, due, trigger }, T);
  assert.equal(p("Mandatory", "Overdue", "2026-11-07"), "High");
  assert.equal(p("Mandatory", "Due in 30 days", "2026-12-06"), "High"); // 14 days out
  assert.equal(p("Mandatory", "Due in 30 days", "2026-12-07"), "Medium"); // 15 days out
  assert.equal(p("Mandatory", "Upcoming", "2027-01-31"), "Medium");
  assert.equal(p("Mandatory", "Ongoing"), "Medium");
  assert.equal(p("Mandatory", "To do", null, "headcount"), "High"); // a threshold just switched it on
  assert.equal(p("Mandatory", "To do"), "Medium");
  assert.equal(p("Optional", "Due in 30 days", "2026-11-25"), "Low");
  assert.equal(p("Optional", "To do", null, "headcount"), "Low");
  assert.equal(p("Not applicable", "Not applicable"), "Low");
  assert.equal(p("Mandatory", "Done"), "Low");
});

test("threshold items carry a trigger", () => {
  for (const k of ["epf_registration", "esi_registration", "posh_ic", "shops_mh", "interns"]) assert.ok(item(k).trigger, k);
  assert.equal(item("itr6").trigger, undefined);
});

test("every item sits in exactly one known segment, and no segment is empty", () => {
  const keys = SEGMENTS.map((s) => s.key);
  for (const i of ITEMS) assert.ok(keys.includes(segmentOf(i)), i.key);
  for (const k of keys) assert.ok(ITEMS.some((i) => segmentOf(i) === k), k);
  assert.equal(segmentOf(item("gstr3b")), "tax");
  assert.equal(segmentOf(item("pt_mh")), "tax");
  assert.equal(segmentOf(item("stat_audit")), "corporate");
  assert.equal(segmentOf(item("certin")), "it");
});
