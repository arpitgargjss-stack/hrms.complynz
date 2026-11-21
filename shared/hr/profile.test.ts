import test from "node:test";
import assert from "node:assert/strict";
import { missingProfileFields, isProfileComplete, REQUIRED_PROFILE_FIELDS } from "./profile";

const full = Object.fromEntries(REQUIRED_PROFILE_FIELDS.map((f) => [f.key, "x"]));

test("profile: all required fields present means complete", () => {
  assert.deepEqual(missingProfileFields(full), []);
  assert.equal(isProfileComplete(full), true);
});
test("profile: blank or missing fields are reported in order", () => {
  assert.deepEqual(missingProfileFields({ ...full, photoFileId: null, currentAddress: "   " }), ["photoFileId", "currentAddress"]);
  assert.equal(isProfileComplete({ ...full, phone: null }), false);
});
test("profile: a completed profile stays complete", () => {
  assert.equal(isProfileComplete({ profileCompletedAt: new Date() }), true);
});
