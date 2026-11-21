import { test } from "node:test";
import assert from "node:assert/strict";
import { IMPORT_COLUMNS, parseImport, rupeesToPaise } from "./payrollImport";

const header = IMPORT_COLUMNS.map((c) => c.label);
const known = new Map([["CMPZ001", "Asha"], ["CMPZ002", "Ravi"]]);
const row = (o: Partial<Record<string, string>>) => IMPORT_COLUMNS.map((c) => o[c.key] ?? "");

test("rupees parse to paise", () => {
  assert.equal(rupeesToPaise("12,345.5"), 1234550);
  assert.equal(rupeesToPaise("₹ 100"), 10000);
  assert.equal(rupeesToPaise(""), 0);
  assert.equal(rupeesToPaise("-5"), null);
  assert.equal(rupeesToPaise("1.234"), null);
});

test("a valid row becomes a payslip with matching net pay", () => {
  const r = parseImport([header, row({ code: "cmpz001", paidDays: "30", calendarDays: "30", BASIC: "30000", HRA: "12000", SPECIAL: "8000", PF_EE: "1800", PT: "200", TDS: "2000", net: "46000" })], "2026-06", known);
  assert.deepEqual(r.issues, []);
  assert.equal(r.slips.length, 1);
  assert.equal(r.slips[0].result.grossPaidPaise, 5000000);
  assert.equal(r.slips[0].result.netPayPaise, 4600000);
  assert.equal(r.slips[0].result.deductions.find((d) => d.code === "TDS")!.amount, 200000);
});

test("columns can be in any order and net pay can be left blank", () => {
  const h = [...header].reverse();
  const vals = row({ code: "CMPZ002", BASIC: "10000" }).reverse();
  const r = parseImport([h, vals], "2026-02", known);
  assert.deepEqual(r.issues, []);
  assert.equal(r.slips[0].calendarDays, 28);
  assert.equal(r.slips[0].result.netPayPaise, 1000000);
});

test("problems are reported per row", () => {
  const r = parseImport([header,
    row({ code: "CMPZ009", BASIC: "1" }),
    row({ code: "CMPZ001", BASIC: "abc" }),
    row({ code: "CMPZ002", BASIC: "1000", net: "5000" }),
  ], "2026-06", known);
  assert.equal(r.slips.length, 0);
  assert.equal(r.issues.length, 3);
  assert.match(r.issues[0].message, /No employee/);
  assert.match(r.issues[2].message, /does not equal/);
});

test("a sheet without the template columns is refused", () => {
  const r = parseImport([["Code", "Amount"], ["CMPZ001", "10"]], "2026-06", known);
  assert.match(r.issues[0].message, /Missing columns/);
});
