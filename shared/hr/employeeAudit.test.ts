import { test } from "node:test";
import assert from "node:assert/strict";
import { workFieldChanges } from "./employeeAudit";

test("records only work fields that changed, with before and after", () => {
  const before = { designationId: "a", employmentType: "full_time", joiningDate: "2024-01-01", workEmail: "x@complynz.com", phone: "1" };
  const after = { designationId: "b", employmentType: "full_time", joiningDate: "2024-02-01", workEmail: "x@complynz.com", phone: "2" };
  assert.deepEqual(workFieldChanges(before, after), {
    designationId: { from: "a", to: "b" },
    joiningDate: { from: "2024-01-01", to: "2024-02-01" },
  });
});

test("treats undefined and null as the same and never logs personal or bank fields", () => {
  assert.deepEqual(workFieldChanges({ locationId: null, pan: "X" }, { pan: "Y" }), {});
  assert.deepEqual(workFieldChanges({ locationId: "l1" }, { locationId: null }), { locationId: { from: "l1", to: null } });
});
