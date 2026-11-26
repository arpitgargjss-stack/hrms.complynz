import { test } from "node:test";
import assert from "node:assert/strict";
import { ageOn, istParts, mergeParty, ordinal } from "./ndaParty";

test("NDA party: first non-empty value per field wins", () => {
  assert.deepEqual(mergeParty({ address: "  ", pan: "ABCDE1234F" }, { address: "12 MG Road,\n Noida", pan: "ZZZZZ9999Z", relationName: "R K Sharma" }),
    { address: "12 MG Road, Noida", pan: "ABCDE1234F", relationName: "R K Sharma" });
});
test("NDA party: Aadhaar must be exactly the last 4 digits", () => {
  assert.equal(mergeParty({ aadhaarLast4: "123456789012" }).aadhaarLast4, null);
  assert.equal(mergeParty({ aadhaarLast4: "0123" }).aadhaarLast4, "0123");
});
test("NDA party: age in completed years", () => {
  assert.equal(ageOn("2000-11-27", new Date("2026-11-26T12:00:00Z")), 25);
  assert.equal(ageOn("2000-11-26", new Date("2026-11-26T12:00:00Z")), 26);
  assert.equal(ageOn("bad", new Date()), null);
});
test("NDA party: ordinals and India-time dates", () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd"]);
  assert.deepEqual(istParts(new Date("2026-11-25T20:00:00Z")), { day: 26, month: "November", year: 2026 });
});
