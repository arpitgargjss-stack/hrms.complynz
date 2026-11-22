import { test } from "node:test";
import assert from "node:assert/strict";
import { maskAccount, renderAdviceHtml } from "./payrollHelpers";

const view = (to: Parameters<typeof renderAdviceHtml>[0]["to"]) => renderAdviceHtml({
  company: "Acme Private Limited", refNo: "BA/2026-11/001", month: "2026-11", date: "2026-11-22", to,
  rows: [{ srNo: 1, name: "Asha Verma", bankName: "HDFC Bank", accountNo: "50100000000001", ifsc: "HDFC0000001", amountPaise: 8500000 }], totalPaise: 8500000, signed: null,
});

test("bank advice keeps each employee's full account number, bank and IFSC", () => {
  const h = view({ bank: "ICICI Bank", branch: "Sector 18", city: "Noida", debitAccount: "001234567890" });
  assert.match(h, /<td>Asha Verma<\/td><td>HDFC Bank<\/td><td>50100000000001<\/td><td>HDFC0000001<\/td>/);
});

test("bank advice is addressed to the company bank with its IFSC and debit account", () => {
  const h = view({ bank: "ICICI Bank", branch: "Sector 18", city: "Noida", debitAccount: "001234567890", ifsc: "ICIC0000018" });
  assert.match(h, /ICICI Bank<br>Sector 18<br>Noida<br>IFSC: ICIC0000018/);
  assert.match(h, /debit our account number 001234567890/);
  assert.doesNotMatch(view({ bank: "B", branch: "", city: "", debitAccount: "1" }), /IFSC: /);
});

test("account numbers are masked for storage and audit", () => assert.equal(maskAccount("001234567890"), "********7890"));
