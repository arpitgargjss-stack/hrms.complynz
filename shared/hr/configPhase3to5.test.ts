import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CHECKLIST, candidateSteps, copyForLink, nextChecklistVersion, validateChecklist, type Checklist } from "./onboardingChecklist";
import { EMAIL_TEMPLATES, emailTemplateDef, fillEmail, unknownEmailPlaceholders } from "./emailTemplates";
import { diffBlocks, diffPolicies, htmlToBlocks } from "./policyDiff";

const v1: Checklist = { ...DEFAULT_CHECKLIST, version: 1 };

test("checklist: a link gets a deep copy, so editing the default later never changes it", () => {
  const link = copyForLink(v1);
  assert.equal(link.version, 1);
  assert.ok(link.items.every((i) => i.done === false && i.doneBy === null));
  v1.items[0].label = "Changed later";
  assert.notEqual(link.items[0].label, "Changed later");
  v1.items[0].label = DEFAULT_CHECKLIST.items[0].label;
  assert.deepEqual(candidateSteps(v1), ["details", "kyc", "bank", "documents"]);
});

test("checklist: saving the same items keeps the version, any change bumps it", () => {
  assert.equal(nextChecklistVersion(v1, v1.items.map((i) => ({ ...i }))), 1);
  assert.equal(nextChecklistVersion(v1, [...v1.items, { id: "x", kind: "custom", label: "Welcome lunch", key: null, required: false }]), 2);
  assert.equal(nextChecklistVersion(v1, v1.items.map((i, n) => (n === 0 ? { ...i, required: false } : i))), 2);
  assert.equal(nextChecklistVersion({ version: 0, items: [] }, v1.items), 1);
});

test("checklist: validation needs a candidate step, known step keys and published policies", () => {
  assert.deepEqual(validateChecklist(v1.items, []), []);
  assert.match(validateChecklist(v1.items.filter((i) => i.kind !== "candidate_step"), []).join(), /at least one step/);
  assert.match(validateChecklist([...v1.items, { id: "p", kind: "policy_ack", label: "POSH", key: "posh", required: true }], ["leave"]).join(), /published policy/);
  assert.deepEqual(validateChecklist([...v1.items, { id: "p", kind: "policy_ack", label: "POSH", key: "posh", required: true }], ["posh"]), []);
  assert.match(validateChecklist([...v1.items, { id: "s", kind: "candidate_step", label: "X", key: "passport", required: true }], []).join(), /Unknown candidate step/);
});

test("email templates: send-time values and fixed placeholders are allowed, anything else is flagged", () => {
  const def = emailTemplateDef("policy_reminder")!;
  assert.deepEqual(unknownEmailPlaceholders(def, "Ack {{policy}}", "Hi {{name}}, {{link}} {{company.brand_name}}"), []);
  assert.deepEqual(unknownEmailPlaceholders(def, "{{expiry}}", "{{made.up}} {{posh.ic.members}}"), ["expiry", "made.up", "posh.ic.members"]); // tables are not allowed in plain-text email
  for (const t of EMAIL_TEMPLATES) assert.deepEqual(unknownEmailPlaceholders(t, t.subject, t.body), [], t.key);
  assert.equal(fillEmail("Hi {{name}} from {{company.brand_name}}{{missing}}", { name: "Asha", "company.brand_name": "Acme" }), "Hi Asha from Acme");
});

test("policy diff marks added and removed blocks and ignores markup-only changes", () => {
  assert.deepEqual(htmlToBlocks("<h1>Leave</h1><p>Casual &amp; sick</p><table><tr><td>A</td><td>12</td></tr></table>"), ["Leave", "Casual & sick", "A | 12"]);
  const d = diffPolicies("<h1>Leave</h1><p>12 days</p><p>Apply early</p>", "<h1>Leave</h1><p>15 days</p><p><b>Apply</b> early</p>");
  assert.deepEqual(d, [{ op: "same", text: "Leave" }, { op: "del", text: "12 days" }, { op: "add", text: "15 days" }, { op: "same", text: "Apply early" }]);
  assert.deepEqual(diffBlocks([], ["a"]), [{ op: "add", text: "a" }]);
});
