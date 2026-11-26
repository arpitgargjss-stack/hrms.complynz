import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRow } from "./bankAdvice";

const ok = { name: "A", bankName: "HDFC Bank", accountNo: "50100000000001", ifsc: "HDFC0000001", amountPaise: 100 };

test("valid row has no errors", () => assert.deepEqual(validateRow(ok), []));
test("missing account and IFSC say missing, not invalid", () => {
  assert.deepEqual(validateRow({ ...ok, accountNo: "", ifsc: "" }), ["Account number missing", "IFSC missing"]);
});
test("bad account and IFSC say what is wrong", () => {
  const e = validateRow({ ...ok, accountNo: "12ab", ifsc: "HDFC123" });
  assert.equal(e[0], "Account number must be 9 to 18 digits");
  assert.match(e[1], /IFSC "HDFC123" is invalid/);
});
