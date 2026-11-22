import { test } from "node:test";
import assert from "node:assert/strict";
import { convertLegacyHtml, keyForBlank } from "./legacyPolicy";
import { chipHtml, fromEditorHtml, toEditorHtml } from "./policyEditor";
import { PLACEHOLDERS, renderTemplate, type Values } from "./placeholders";

const label = (k: string) => PLACEHOLDERS.find((p) => p.key === k)?.label ?? null;

test("legacy POSH blanks become placeholders; unknown blanks are kept and reported; running twice changes nothing", () => {
  const html = `<p>The Presiding Officer is [Name of Presiding Officer] ([Presiding Officer email]).</p><p>External member: [External member name], [NGO name].</p>
<p>Members: [Committee members]</p><p>Grievance officer: [Grievance Officer name]. HR: [HR Manager name], [HR email].</p><p>Signed [Something odd]</p>`;
  const r = convertLegacyHtml(html);
  assert.deepEqual(r.replaced.map((x) => x.key), ["posh.ic.presiding_officer.name", "posh.ic.presiding_officer.email", "posh.ic.external_member.name", "posh.ic.external_member.organisation",
    "posh.ic.members", "contacts.grievance_officer.name", "contacts.hr_contact.name", "contacts.hr_contact.email"]);
  assert.deepEqual(r.unknownBlanks, ["Something odd"]);
  assert.match(r.template, /\[Something odd\]/);
  const again = convertLegacyHtml(r.template);
  assert.equal(again.template, r.template);
  assert.deepEqual(again.replaced, []);
  assert.equal(keyForBlank("Company name"), "company.legal_name");
  assert.equal(keyForBlank("date"), null);
});

test("a converted legacy policy renders live with current values, and shows what is still missing", () => {
  const { template } = convertLegacyHtml("<p>[Presiding Officer] and [Grievance Officer]</p>");
  const v1: Values = { "posh.ic.presiding_officer.name": "Asha", "contacts.grievance_officer.name": null };
  const r1 = renderTemplate(template, v1);
  assert.match(r1.html, /Asha/);
  assert.deepEqual(r1.missing, ["contacts.grievance_officer.name"]);
  const r2 = renderTemplate(template, { ...v1, "posh.ic.presiding_officer.name": "Meera", "contacts.grievance_officer.name": "Ravi" });
  assert.match(r2.html, /Meera and Ravi/); // same version, new values: no re-publish needed
  assert.notEqual(r1.html, r2.html);
});

test("the acknowledgement snapshot records exactly the values shown", () => {
  const r = renderTemplate("<p>{{company.legal_name}} {{posh.ic.members}}</p>", { "company.legal_name": "Acme", "posh.ic.members": { headers: ["Name"], rows: [["Asha"]] } });
  assert.deepEqual(r.snapshot, { "company.legal_name": "Acme", "posh.ic.members": { headers: ["Name"], rows: [["Asha"]] } });
});

test("editor chips round-trip to the exact {{key}} template", () => {
  const tpl = "<h2>3. Committee</h2><p>Presiding officer: {{posh.ic.presiding_officer.name}}. Ask {{ contacts.hr_contact.name }}.</p>{{posh.ic.members}}<p>{{made.up}}</p>";
  const ed = toEditorHtml(tpl, label);
  assert.match(ed, /contenteditable="false" data-ph="posh.ic.presiding_officer.name"[^>]*>Presiding officer</);
  assert.match(ed, /ph-chip ph-chip-bad[^>]*data-ph="made.up"/);
  assert.equal(fromEditorHtml(ed), tpl.replace("{{ contacts.hr_contact.name }}", "{{contacts.hr_contact.name}}"));
  // what a browser hands back after typing around a chip
  const typed = `<h2>3. Committee</h2><div>Hello ${chipHtml("company.legal_name", "Legal name")}&nbsp;team<br></div><p><br></p>`;
  assert.equal(fromEditorHtml(typed), "<h2>3. Committee</h2><p>Hello {{company.legal_name}} team</p>");
});
