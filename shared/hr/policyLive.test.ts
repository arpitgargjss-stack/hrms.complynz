import { test } from "node:test";
import assert from "node:assert/strict";
import { convertLegacyHtml, keyForBlank, legacyBlanks, replaceBlank, suggestFor } from "./legacyPolicy";
import { chipHtml, fromEditorHtml, toEditorHtml } from "./policyEditor";
import { PLACEHOLDERS, renderTemplate, type Values } from "./placeholders";

const label = (k: string) => PLACEHOLDERS.find((p) => p.key === k)?.label ?? null;

test("legacy POSH policy: the committee table and IC mailbox link to Configuration (exact shape of posh.html)", () => {
  const html = `<h2>4. Internal Committee (IC)</h2>
<table class="g"><tr><th>Role</th><th>Name</th></tr>
<tr><td>Presiding Officer (senior woman employee)</td><td><span class="ph">[Name]</span></td></tr>
<tr><td>Member (employee)</td><td><span class="ph">[Name]</span></td></tr>
<tr><td>Member (employee)</td><td><span class="ph">[Name]</span></td></tr>
<tr><td>External member (NGO or person familiar with sexual harassment issues)</td><td><span class="ph">[Name]</span></td></tr></table>
<p>At least half of the members are women. Members hold office for up to three years. The IC can be contacted at <span class="ph">[ic@complynz.com]</span>.</p>`;
  const r = convertLegacyHtml(html);
  assert.equal(r.template, `<h2>4. Internal Committee (IC)</h2>
{{posh.ic.members}}
<p>At least half of the members are women. Members hold office for up to three years. The IC can be contacted at {{posh.ic.email}}.</p>`);
  assert.deepEqual(r.replaced.map((x) => x.key), ["posh.ic.members", "posh.ic.email"]);
  assert.deepEqual(r.unmatched, []);
  assert.deepEqual(convertLegacyHtml(r.template).template, r.template); // idempotent
  assert.deepEqual(legacyBlanks(r.template), []);
});

test("other policies: [Name] by row label, mailboxes, leave days; numbers with no setting are reported, not guessed", () => {
  const wb = `<tr><td>Ethics Officer</td><td><span class="ph">[Name]</span>, <span class="ph">[ethics@complynz.com]</span></td></tr>
<tr><td>Anonymous report</td><td><span class="ph">[Anonymous form link]</span>.</td></tr>
<tr><td>If the concern involves the Ethics Officer or a founder</td><td><span class="ph">[Independent director or external ombudsperson, contact]</span></td></tr>`;
  assert.equal(convertLegacyHtml(wb).template, `<tr><td>Ethics Officer</td><td>{{contacts.ethics_officer.name}}, {{contacts.ethics_officer.email}}</td></tr>
<tr><td>Anonymous report</td><td>{{whistleblower.form_link}}.</td></tr>
<tr><td>If the concern involves the Ethics Officer or a founder</td><td>{{contacts.ombudsperson.name}}, {{contacts.ombudsperson.email}}</td></tr>`);
  const leave = `<tr><td>Paternity leave</td><td><span class="ph">[5]</span> working days</td></tr><tr><td>Bereavement leave</td><td><span class="ph">[3]</span> working days</td></tr>`;
  assert.deepEqual(convertLegacyHtml(leave).replaced.map((x) => x.key), ["leave.paternity.days", "leave.bereavement.days"]);
  const mail = `<p>write to HR at <span class="ph">[hr@complynz.com]</span>, privacy at <span class="ph">[privacy@complynz.com]</span>, incidents to <span class="ph">[security@complynz.com]</span>.</p>`;
  assert.deepEqual(convertLegacyHtml(mail).replaced.map((x) => x.key), ["contacts.hr_contact.email", "contacts.dpo.email", "contacts.security.email"]);
  const travel = `<p>paid within <span class="ph">[30]</span> days of approval.</p>`;
  const t = convertLegacyHtml(travel);
  assert.equal(t.template, travel);
  assert.equal(t.unmatched[0].blank, "30");
  assert.match(t.unmatched[0].reason, /no Configuration setting/);
  assert.deepEqual(legacyBlanks(t.template), ["30"]);
  assert.equal(replaceBlank(t.template, "30", "reimbursement.submit_within_days"), "<p>paid within {{reimbursement.submit_within_days}} days of approval.</p>");
  assert.equal(keyForBlank("Company name"), "company.legal_name");
  assert.equal(keyForBlank("date"), null);
});

test("every key the converter can produce is on the fixed placeholder list", () => {
  const all = [...PLACEHOLDERS.map((p) => p.key)];
  const sample = `<p>[Name of Presiding Officer] [Presiding Officer email] [External member name] [NGO name] [Committee members] [Grievance Officer name] [HR Manager name] [HR email]
[DPO email] [Data protection officer] [Ethics Officer email] [Anonymous form link] [Company name] [Registered address] [CIN] [Website] [Signatory] [ic@x.com] [grievance@x.com]</p>`;
  for (const m of convertLegacyHtml(sample).replaced) assert.ok(all.includes(m.key), m.key);
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
  assert.match(ed, /contenteditable="false" data-ph="posh.ic.presiding_officer.name"[^>]*>POSH presiding officer: name</);
  assert.match(ed, /ph-chip ph-chip-bad[^>]*data-ph="made.up"/);
  assert.equal(fromEditorHtml(ed), tpl.replace("{{ contacts.hr_contact.name }}", "{{contacts.hr_contact.name}}"));
  // what a browser hands back after typing around a chip
  const typed = `<h2>3. Committee</h2><div>Hello ${chipHtml("company.legal_name", "Legal name")}&nbsp;team<br></div><p><br></p>`;
  assert.equal(fromEditorHtml(typed), "<h2>3. Committee</h2><p>Hello {{company.legal_name}} team</p>");
});

test("real POSH policy (fixture from the published policy files): v1 and a browser-edited v2 draft both link fully", async () => {
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(new URL("./fixtures/posh-legacy.html", import.meta.url), "utf8");
  const v1 = convertLegacyHtml(html);
  assert.deepEqual(v1.replaced.map((x) => x.key), ["posh.ic.members", "posh.ic.email"]);
  assert.deepEqual(legacyBlanks(v1.template), []);
  // what a browser's contentEditable hands back: <tbody> added, &nbsp; around spans
  const edited = html.replace(/<table class="g"><tr>/g, '<table class="g"><tbody><tr>').replace(/<\/tr><\/table>/g, "</tr></tbody></table>").replace(/at <span class="ph">/, "at&nbsp;<span class=\"ph\">");
  const v2 = convertLegacyHtml(edited);
  assert.ok(v2.template.includes("{{posh.ic.members}}"));
  assert.ok(v2.template.includes("{{posh.ic.email}}"));
  assert.deepEqual(legacyBlanks(v2.template), []);
});

test("suggested field for a blank left in a committee table follows the row, counting member rows", () => {
  const t = `<table><tr><td>Presiding Officer</td><td>[Name]</td></tr><tr><td>Member (employee)</td><td>[Nm]</td></tr><tr><td>Member (employee)</td><td>[Nme]</td></tr><tr><td>External member</td><td>[N]</td></tr></table><p>Write to [hr@x.com]</p>`;
  assert.equal(suggestFor(t, "Name"), "posh.ic.presiding_officer.name");
  assert.equal(suggestFor(t, "Nm"), "posh.ic.members.1.name");
  assert.equal(suggestFor(t, "Nme"), "posh.ic.members.2.name");
  assert.equal(suggestFor(t, "N"), "posh.ic.external_member.name");
  assert.equal(suggestFor(t, "hr@x.com"), "contacts.hr_contact.email");
  for (const k of ["posh.ic.members.1.name", "posh.ic.members.2.name", "posh.ic.external_member.email", "contacts.dpo.name", "contacts.ethics_officer.phone"]) assert.ok(PLACEHOLDERS.some((p) => p.key === k && p.group === "People"), k);
});

test("a whole-document policy keeps its <style> and <title> outside the editor and gets them back on save", async () => {
  const { splitHead } = await import("./policyEditor");
  const doc = `<!doctype html><html><head><meta charset="utf-8"><title>POSH</title><style>.g{border:1px}</style></head><body><h1>POSH</h1><p>{{company.legal_name}}</p></body></html>`;
  const { head, body } = splitHead(doc);
  assert.equal(body, "<h1>POSH</h1><p>{{company.legal_name}}</p>");
  assert.equal(head, `<!doctype html><title>POSH</title><style>.g{border:1px}</style><meta charset="utf-8">`);
  assert.equal(head + fromEditorHtml(toEditorHtml(body, label)), head + body);
});
