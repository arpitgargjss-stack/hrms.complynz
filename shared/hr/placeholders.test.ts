import { test } from "node:test";
import assert from "node:assert/strict";
import { PLACEHOLDERS, canPublishRender, changedSince, nextPolicyStatus, placeholdersIn, renderTemplate, type Values } from "./placeholders";
import { STARTER_TEMPLATES } from "./policyTemplates";

const full = (): Values => Object.fromEntries(PLACEHOLDERS.map((p) => [p.key, p.kind === "table" ? { headers: ["Role", "Name"], rows: [["Presiding officer", "Asha"]] } : `v-${p.key}`]));

test("placeholder keys are unique", () => {
  assert.equal(new Set(PLACEHOLDERS.map((p) => p.key)).size, PLACEHOLDERS.length);
});

test("every starter template uses only known placeholders and renders fully when values exist", () => {
  for (const s of STARTER_TEMPLATES) {
    const r = renderTemplate(s.html, full());
    assert.deepEqual(r.unknown, [], s.slug);
    assert.deepEqual(r.missing, [], s.slug);
    assert.ok(!r.html.includes("{{"), s.slug);
  }
});

test("renders text and tables, and escapes HTML in values", () => {
  const r = renderTemplate("<p>{{company.legal_name}}</p>{{posh.ic.members}}", {
    "company.legal_name": `Acme <script>alert(1)</script> & "Co"`,
    "posh.ic.members": { headers: ["Name"], rows: [["<b>Ravi</b>"]] },
  });
  assert.equal(r.html, `<p>Acme &lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Co&quot;</p><table><thead><tr><th>Name</th></tr></thead><tbody><tr><td>&lt;b&gt;Ravi&lt;/b&gt;</td></tr></tbody></table>`);
  assert.deepEqual(r.used, ["company.legal_name", "posh.ic.members"]);
});

test("missing and unknown placeholders block publishing and are marked in the preview", () => {
  const r = renderTemplate("{{company.cin}} {{ company.legal_name }} {{made.up}}", { "company.legal_name": "Acme", "company.cin": "  " });
  assert.deepEqual(r.missing, ["company.cin"]);
  assert.deepEqual(r.unknown, ["made.up"]);
  assert.equal(canPublishRender(r), false);
  assert.match(r.html, /ph-missing">\[CIN\]/);
  assert.match(r.html, /ph-bad">\{\{made\.up\}\}/);
  assert.equal(canPublishRender(renderTemplate("{{company.legal_name}}", { "company.legal_name": "Acme" })), true);
  assert.deepEqual(placeholdersIn("{{a.b}} {{a.b}} {{c.d}}"), ["a.b", "c.d"]);
});

test("a published version is out of date when a value it used changes", () => {
  const snap = renderTemplate("{{company.legal_name}} {{posh.ic.members}}", full()).snapshot;
  assert.deepEqual(changedSince(snap, full()), []);
  const now = { ...full(), "company.legal_name": "New name", "company.cin": "changed but unused" };
  assert.deepEqual(changedSince(snap, now), ["company.legal_name"]);
  const table = { ...full(), "posh.ic.members": { headers: ["Role", "Name"], rows: [["Presiding officer", "Meera"]] } };
  assert.deepEqual(changedSince(snap, table), ["posh.ic.members"]);
  // jsonb returns object keys in a different order; that alone is not a change
  const reordered = { ...snap, "posh.ic.members": { rows: [["Presiding officer", "Asha"]], headers: ["Role", "Name"] } } as typeof snap;
  assert.deepEqual(changedSince(reordered, full()), []);
});

test("approval flow matches letters: HR or finance drafts and submits, only the CEO approves", () => {
  const hr = { ceo: false, editor: true }, ceo = { ceo: true, editor: true }, viewer = { ceo: false, editor: false };
  assert.equal(nextPolicyStatus("draft", "submit", hr), "pending_approval");
  assert.equal(nextPolicyStatus("pending_approval", "approve", hr), null);
  assert.equal(nextPolicyStatus("pending_approval", "approve", ceo), "approved");
  assert.equal(nextPolicyStatus("pending_approval", "return", ceo), "draft");
  assert.equal(nextPolicyStatus("draft", "approve", ceo), "approved"); // CEO's own draft
  assert.equal(nextPolicyStatus("draft", "publish", hr), null); // never publish without approval
  assert.equal(nextPolicyStatus("approved", "publish", hr), "published");
  assert.equal(nextPolicyStatus("approved", "edit", hr), "draft"); // editing an approved version needs approval again
  assert.equal(nextPolicyStatus("published", "edit", ceo), null); // published versions are frozen
  assert.equal(nextPolicyStatus("draft", "submit", viewer), null);
});
