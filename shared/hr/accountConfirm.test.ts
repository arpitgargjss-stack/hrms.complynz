import test from "node:test";
import assert from "node:assert/strict";
import { accountConfirmError } from "./accountConfirm";

test("account number must be confirmed and match", () => {
  assert.equal(accountConfirmError("", ""), null);
  assert.equal(accountConfirmError("123456789012", "123456789012"), null);
  assert.equal(accountConfirmError("1234 5678 9012", "123456789012"), null);
  assert.match(accountConfirmError("123456789012", "")!, /Re-enter/);
  assert.match(accountConfirmError("123456789012", "123456789021")!, /do not match/);
  assert.match(accountConfirmError("", "123")!, /do not match/);
});
