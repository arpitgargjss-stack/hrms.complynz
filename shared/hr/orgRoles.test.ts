import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPoshCommittee, committeeReady, type Committee, type Person } from "./orgRoles";

const p = (name: string, gender: Person["gender"], employeeId: string | null = `e-${name}`): Person => ({ employeeId, name, email: null, phone: null, designation: null, organisation: null, gender });
const ok: Committee = { presiding: p("Asha", "female"), members: [p("Ravi", "male"), p("Meera", "female")], external: p("NGO Rep", "male", null), termStart: "2026-01-01", termEnd: "2028-12-31" };
const T = "2026-11-22";
const failing = (c: Committee) => checkPoshCommittee(c, T).filter((x) => !x.ok).map((x) => x.key);

test("a valid committee passes every check", () => {
  assert.deepEqual(failing(ok), []);
  assert.equal(committeeReady(ok, T), true);
});

test("presiding officer must be a woman employee", () => {
  assert.ok(failing({ ...ok, presiding: p("Asha", "male") }).includes("presiding"));
  assert.ok(failing({ ...ok, presiding: p("Asha", "female", null) }).includes("presiding"));
  assert.ok(failing({ ...ok, presiding: null }).includes("presiding"));
});

test("needs 2 employee members, an external member and 4 people in all", () => {
  const f = failing({ ...ok, members: [p("Ravi", "male")] });
  assert.ok(f.includes("members") && f.includes("size"));
  assert.ok(failing({ ...ok, members: [p("Ravi", "male"), p("Typed", "female", null)] }).includes("members")); // typed-in people are not employees
  assert.ok(failing({ ...ok, external: null }).includes("external"));
});

test("at least half must be women", () => {
  assert.ok(failing({ ...ok, members: [p("Ravi", "male"), p("Karan", "male")] }).includes("women")); // 1 of 4
  assert.deepEqual(failing({ ...ok, members: [p("Ravi", "male"), p("Meera", "female"), p("Karan", "male")], external: p("NGO", "female", null) }), []); // 3 of 5
});

test("the same person cannot be listed twice", () => {
  assert.ok(failing({ ...ok, members: [p("Asha", "female"), p("Meera", "female")] }).includes("unique"));
});

test("term must be set, at most 3 years, and current", () => {
  assert.ok(failing({ ...ok, termStart: null }).includes("term"));
  assert.ok(failing({ ...ok, termEnd: "2029-01-02" }).includes("term"));
  assert.ok(failing({ ...ok, termEnd: "2025-12-31" }).includes("term"));
  const expired = failing({ ...ok, termStart: "2023-01-01", termEnd: "2025-12-31" });
  assert.ok(expired.includes("current"));
});
