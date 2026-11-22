import test from "node:test";
import assert from "node:assert/strict";
import { scopeFor, canAccess, SUPER_ADMIN_IMPLIES } from "./access";

test("team member sees only own comp; finance sees all", () => {
  assert.equal(scopeFor(["team_member"], "comp.read"), "own");
  assert.equal(scopeFor(["team_member", "finance_signatory"], "comp.read"), "all");
});
test("manager cannot read comp of reports or ID docs of others", () => {
  assert.equal(scopeFor(["team_member", "manager"], "comp.read"), "own");
  assert.equal(scopeFor(["team_member", "manager"], "id_docs.read"), "own");
});
test("only HR runs payroll and accepts resignations; HR cannot sign", () => {
  assert.equal(scopeFor(["team_member", "manager"], "payroll.run"), "none");
  assert.equal(scopeFor(["team_member", "finance_signatory"], "payroll.run"), "all");
  assert.equal(scopeFor(["hr_admin"], "resign.accept"), "all");
  assert.equal(scopeFor(["hr_admin"], "sign.documents"), "none");
});
test("canAccess enforces scope", () => {
  const a = { employeeId: "m", directReportIds: ["r1"] };
  assert.ok(canAccess("reports", a, "r1")); assert.ok(!canAccess("reports", a, "x"));
  assert.ok(canAccess("own", a, "m")); assert.ok(!canAccess("own", a, "r1"));
});

test("admin configuration: HR admin, finance admin and super admin edit; others do not", () => {
  assert.equal(scopeFor(["hr_admin"], "settings.manage"), "all");
  assert.equal(scopeFor(["finance_signatory"], "settings.manage"), "all");
  assert.equal(scopeFor(["super_admin", ...SUPER_ADMIN_IMPLIES], "settings.manage"), "all"); // super admin holds both roles
  assert.equal(scopeFor(["manager"], "settings.manage"), "none");
  assert.equal(scopeFor(["team_member"], "settings.manage"), "none");
});
