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

test("profile: acknowledgements are missing until each is granted", async () => {
  const { missingAcknowledgements, PROFILE_ACKNOWLEDGEMENTS } = await import("./profile");
  assert.equal(missingAcknowledgements(new Map()).length, PROFILE_ACKNOWLEDGEMENTS.length);
  const all = new Map(PROFILE_ACKNOWLEDGEMENTS.map((a) => [a.key as string, "granted"]));
  assert.deepEqual(missingAcknowledgements(all), []);
  all.set("ack_privacy_notice", "withdrawn");
  assert.deepEqual(missingAcknowledgements(all), ["ack_privacy_notice"]);
});
