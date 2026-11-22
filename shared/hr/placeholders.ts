/**
 * Policy placeholders and the policy approval flow.
 * Placeholders are a fixed list: HR can use only the keys below, written as {{key}}. Values come from Admin
 * configuration and the existing settings (company profile, POSH committee, named contacts, leave types, reimbursement policy).
 * Rendering escapes every value. A table value (such as posh.ic.members) renders as an HTML table.
 */
export type PlaceholderGroup = "Company" | "POSH committee" | "Contacts" | "Leave" | "Reimbursement";
export type PlaceholderDef = { key: string; label: string; group: PlaceholderGroup; kind: "text" | "table"; source: string };
export type Table = { headers: string[]; rows: string[][] };
export type Value = string | Table | null;
export type Values = Record<string, Value>;

const t = (key: string, label: string, group: PlaceholderGroup, source: string): PlaceholderDef => ({ key, label, group, kind: "text", source });
const tbl = (key: string, label: string, group: PlaceholderGroup, source: string): PlaceholderDef => ({ key, label, group, kind: "table", source });
export const PLACEHOLDERS: PlaceholderDef[] = [
  t("company.legal_name", "Legal name", "Company", "Configuration → Company"),
  t("company.brand_name", "Brand name", "Company", "Configuration → Company"),
  t("company.registered_address", "Registered address", "Company", "Configuration → Company"),
  t("company.cin", "CIN", "Company", "Configuration → Company"),
  t("company.email", "Company email", "Company", "Configuration → Company"),
  t("company.website", "Website", "Company", "Configuration → Company"),
  t("company.signatory_name", "Signatory name", "Company", "Configuration → Company"),
  t("company.signatory_designation", "Signatory designation", "Company", "Configuration → Company"),
  t("posh.ic.presiding_officer.name", "Presiding officer", "POSH committee", "Configuration → People and committees"),
  t("posh.ic.presiding_officer.email", "Presiding officer email", "POSH committee", "Configuration → People and committees"),
  t("posh.ic.external_member.name", "External member", "POSH committee", "Configuration → People and committees"),
  t("posh.ic.external_member.organisation", "External member organisation", "POSH committee", "Configuration → People and committees"),
  tbl("posh.ic.members", "All committee members (table)", "POSH committee", "Configuration → People and committees"),
  t("posh.ic.term_start", "Term starts", "POSH committee", "Configuration → People and committees"),
  t("posh.ic.term_end", "Term ends", "POSH committee", "Configuration → People and committees"),
  t("contacts.grievance_officer.name", "Grievance officer", "Contacts", "Configuration → People and committees"),
  t("contacts.grievance_officer.email", "Grievance officer email", "Contacts", "Configuration → People and committees"),
  t("contacts.dpo.name", "Data protection officer", "Contacts", "Configuration → People and committees"),
  t("contacts.dpo.email", "Data protection officer email", "Contacts", "Configuration → People and committees"),
  t("contacts.hr_contact.name", "HR contact", "Contacts", "Configuration → People and committees"),
  t("contacts.hr_contact.email", "HR contact email", "Contacts", "Configuration → People and committees"),
  tbl("leave.types", "All leave types with yearly quota (table)", "Leave", "Leave types"),
  t("leave.casual.days", "Casual leave days a year", "Leave", "Leave types"),
  t("leave.sick.days", "Sick leave days a year", "Leave", "Leave types"),
  t("reimbursement.bill_required_above", "Bill needed above", "Reimbursement", "Reimbursement policy"),
  t("reimbursement.manager_approval_above", "Manager approval above", "Reimbursement", "Reimbursement policy"),
  t("reimbursement.ceo_approval_above", "CEO approval above", "Reimbursement", "Reimbursement policy"),
  t("reimbursement.submit_within_days", "Submit within (days)", "Reimbursement", "Reimbursement policy"),
];
const KNOWN = new Set(PLACEHOLDERS.map((p) => p.key));
export const isKnownPlaceholder = (k: string) => KNOWN.has(k);

const RE = /\{\{\s*([a-z0-9_.]+)\s*\}\}/g;
/** Keys used in a template, in order of first use. Unknown keys are included so the editor can flag them. */
export function placeholdersIn(template: string): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(RE)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const isEmpty = (v: Value | undefined) => v == null || (typeof v === "string" ? !v.trim() : !v.rows.length);
function renderValue(v: Value): string {
  if (v == null) return "";
  if (typeof v === "string") return esc(v);
  return `<table><thead><tr>${v.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${v.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

export type RenderResult = { html: string; used: string[]; unknown: string[]; missing: string[]; snapshot: Values };
/**
 * Fills placeholders. Unknown keys and empty values are reported and left visible as marked blanks,
 * so a preview shows exactly what still needs setting up. `snapshot` holds the values used, for freezing a published version.
 */
export function renderTemplate(template: string, values: Values): RenderResult {
  const used = placeholdersIn(template);
  const unknown = used.filter((k) => !KNOWN.has(k));
  const missing = used.filter((k) => KNOWN.has(k) && isEmpty(values[k]));
  const html = template.replace(RE, (_m, k: string) => {
    if (!KNOWN.has(k)) return `<mark class="ph-bad">{{${esc(k)}}}</mark>`;
    if (isEmpty(values[k])) return `<mark class="ph-missing">[${esc(PLACEHOLDERS.find((p) => p.key === k)!.label)}]</mark>`;
    return renderValue(values[k]!);
  });
  return { html, used, unknown, missing, snapshot: Object.fromEntries(used.filter((k) => KNOWN.has(k)).map((k) => [k, values[k] ?? null])) };
}
export const canPublishRender = (r: Pick<RenderResult, "unknown" | "missing">) => !r.unknown.length && !r.missing.length;

/** Keys whose value today differs from the value frozen into a published version. */
export function changedSince(snapshot: Values, current: Values): string[] {
  return Object.keys(snapshot).filter((k) => stable(snapshot[k] ?? null) !== stable(current[k] ?? null));
}
/** JSON with sorted object keys, so a value read back from the database (jsonb reorders keys) compares equal. */
function stable(v: unknown): string {
  if (v && typeof v === "object" && !Array.isArray(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  return JSON.stringify(v);
}

// ---------------------------------------------------------------- approval flow
export type PolicyStatus = "draft" | "pending_approval" | "approved" | "published";
export type PolicyAction = "submit" | "approve" | "return" | "publish" | "edit";
export const POLICY_STATUS_LABEL: Record<PolicyStatus, string> = { draft: "Draft", pending_approval: "Waiting for CEO approval", approved: "Approved, not published", published: "Published" };
/**
 * Same rules as letters: HR admin or finance admin drafts and submits; only the CEO (super admin) approves or
 * sends back; a super admin's own draft can be approved straight away; only an approved version is published.
 * Editing an approved or pending version sends it back to draft. A published version never changes.
 */
export function nextPolicyStatus(from: PolicyStatus, action: PolicyAction, actor: { ceo: boolean; editor: boolean }): PolicyStatus | null {
  if (from === "published") return null;
  switch (action) {
    case "edit": return actor.editor ? "draft" : null;
    case "submit": return from === "draft" && actor.editor ? "pending_approval" : null;
    case "approve": return actor.ceo && (from === "pending_approval" || from === "draft") ? "approved" : null;
    case "return": return actor.ceo && from === "pending_approval" ? "draft" : null;
    case "publish": return from === "approved" && actor.editor ? "published" : null;
  }
}
