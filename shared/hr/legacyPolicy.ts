/**
 * Turns a policy written before fields existed (HTML with "[Name]"-style blanks, often wrapped in
 * <span class="ph">…</span>) into a template whose blanks fill in from Configuration.
 *
 * Matching uses context, not just the blank's own words: the table row label, the sentence before it and the address
 * itself for e-mail blanks. A committee table (Presiding Officer / Member / External member rows) becomes the
 * {{posh.ic.members}} table, so a committee of any size shows correctly. Blanks that cannot be matched with confidence
 * are left exactly as written and reported with a reason. Running it again on its own output changes nothing.
 */
export type Mapped = { blank: string; key: string; context: string };
export type Unmatched = { blank: string; reason: string; context: string };
export type LegacyResult = { template: string; replaced: Mapped[]; unmatched: Unmatched[]; unknownBlanks: string[] };

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

// Blank wording that names its value on its own.
const BY_WORDING: { test: RegExp; key: string }[] = [
  { test: /presiding.*(e-?mail|contact)|(e-?mail|contact).*presiding/i, key: "posh.ic.presiding_officer.email" },
  { test: /presiding/i, key: "posh.ic.presiding_officer.name" },
  { test: /external.*(organi[sz]ation|ngo)|(organi[sz]ation|ngo).*external|^ngo|ngo name/i, key: "posh.ic.external_member.organisation" },
  { test: /external member/i, key: "posh.ic.external_member.name" },
  { test: /(committee|ic|icc)\s*members?|members? of the (internal )?committee|member names|members list/i, key: "posh.ic.members" },
  { test: /(term|valid).*(start|from)|(start|from).*term|effective from|date of constitution/i, key: "posh.ic.term_start" },
  { test: /(term|valid).*(end|till|until)|(end|expiry).*term/i, key: "posh.ic.term_end" },
  { test: /grievance.*(e-?mail|contact)|(e-?mail|contact).*grievance/i, key: "contacts.grievance_officer.email" },
  { test: /grievance/i, key: "contacts.grievance_officer.name" },
  { test: /(dpo|data protection).*(e-?mail|contact)|(e-?mail|contact).*(dpo|data protection)/i, key: "contacts.dpo.email" },
  { test: /\bdpo\b|data protection officer/i, key: "contacts.dpo.name" },
  { test: /ethics.*(e-?mail|contact)/i, key: "contacts.ethics_officer.email" },
  { test: /ethics officer/i, key: "contacts.ethics_officer.name" },
  { test: /anonymous.*(form|link|channel)|whistle.?blow.*(form|link)/i, key: "whistleblower.form_link" },
  { test: /\bhr\b.*(e-?mail)|(e-?mail).*\bhr\b/i, key: "contacts.hr_contact.email" },
  { test: /\bhr\b.*(manager|contact|head|person|name)|hr manager|human resources/i, key: "contacts.hr_contact.name" },
  { test: /signatory.*(designation|title)|designation of (the )?signatory/i, key: "company.signatory_designation" },
  { test: /signatory|authori[sz]ed (signatory|person)/i, key: "company.signatory_name" },
  { test: /\bcin\b/i, key: "company.cin" },
  { test: /registered (office )?address|company address|office address/i, key: "company.registered_address" },
  { test: /company('s)? (legal )?name|name of (the )?company|legal name|employer name|organi[sz]ation name/i, key: "company.legal_name" },
  { test: /company e-?mail|official e-?mail/i, key: "company.email" },
  { test: /website/i, key: "company.website" },
];
// E-mail blanks: the mailbox name says whose address it is.
const BY_MAILBOX: { test: RegExp; key: string }[] = [
  { test: /^(ic|icc|posh|internal-?committee)@/i, key: "posh.ic.email" },
  { test: /^(hr|people|careers?)@/i, key: "contacts.hr_contact.email" },
  { test: /^(privacy|dpo|dataprotection|data-protection)@/i, key: "contacts.dpo.email" },
  { test: /^(grievance|grievances)@/i, key: "contacts.grievance_officer.email" },
  { test: /^(security|infosec|it-?security|soc)@/i, key: "contacts.security.email" },
  { test: /^(ethics|whistleblower|integrity|compliance)@/i, key: "contacts.ethics_officer.email" },
];
// Generic blanks ("[Name]", "[5]") read the row label or sentence just before them.
const BY_CONTEXT: { blank: RegExp; context: RegExp; key: string }[] = [
  { blank: /^name$/i, context: /presiding officer/i, key: "posh.ic.presiding_officer.name" },
  { blank: /^name$/i, context: /external member/i, key: "posh.ic.external_member.name" },
  { blank: /^name$/i, context: /ethics officer/i, key: "contacts.ethics_officer.name" },
  { blank: /^name$/i, context: /grievance officer/i, key: "contacts.grievance_officer.name" },
  { blank: /^name$/i, context: /data protection officer|\bdpo\b/i, key: "contacts.dpo.name" },
  { blank: /^name$/i, context: /\bhr\b|human resources/i, key: "contacts.hr_contact.name" },
  { blank: /^\d{1,3}$/, context: /paternity leave/i, key: "leave.paternity.days" },
  { blank: /^\d{1,3}$/, context: /bereavement leave/i, key: "leave.bereavement.days" },
  { blank: /^\d{1,3}$/, context: /casual leave/i, key: "leave.casual.days" },
  { blank: /^\d{1,3}$/, context: /sick leave/i, key: "leave.sick.days" },
];
const SPECIAL: { test: RegExp; replace: string; keys: string[] }[] = [
  { test: /ombuds|independent director/i, replace: "{{contacts.ombudsperson.name}}, {{contacts.ombudsperson.email}}", keys: ["contacts.ombudsperson.name", "contacts.ombudsperson.email"] },
];

const BLANK = /<span class="ph">\s*\[([^\]\[<>{}\n]{1,90})\]\s*<\/span>|\[([^\]\[<>{}\n]{1,90})\]/g;
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
const isCommitteeTable = (t: string) => /presiding officer/i.test(text(t)) && /member/i.test(text(t)) && /\[(name|[^\]]*name[^\]]*)\]/i.test(t);

export function convertLegacyHtml(html: string): LegacyResult {
  const replaced: Mapped[] = [], unmatched: Unmatched[] = [];
  // 1. A committee table with name blanks becomes the live committee table.
  let template = html.replace(/<table\b[\s\S]*?<\/table>/gi, (t) => {
    if (!isCommitteeTable(t)) return t;
    replaced.push({ blank: `committee table (${(t.match(BLANK) ?? []).length} blanks)`, key: "posh.ic.members", context: "Presiding Officer / Member / External member rows" });
    return "{{posh.ic.members}}";
  });
  // 2. Every other blank, using its own words, its mailbox, or the row label / sentence before it.
  template = template.replace(BLANK, (whole, a: string | undefined, b: string | undefined, offset: number, all: string) => {
    const blank = (a ?? b ?? "").trim();
    if (/^\{\{/.test(blank)) return whole;
    const before = text(all.slice(Math.max(0, offset - 400), offset));
    const rowStart = all.lastIndexOf("<tr", offset), rowLabel = rowStart >= 0 && rowStart > all.lastIndexOf("</tr>", offset) ? text(all.slice(rowStart, offset)) : "";
    const ctx = (rowLabel || before.slice(-160)).trim();
    const special = SPECIAL.find((s) => s.test.test(blank));
    if (special) { special.keys.forEach((k) => replaced.push({ blank, key: k, context: ctx })); return special.replace; }
    const key = isEmail(blank) ? BY_MAILBOX.find((m) => m.test.test(blank))?.key ?? (/internal committee|\bic\b/i.test(before.slice(-200)) ? "posh.ic.email" : undefined)
      : BY_WORDING.find((r) => r.test.test(blank))?.key ?? BY_CONTEXT.find((r) => r.blank.test(blank) && r.context.test(rowLabel || before.slice(-120)))?.key;
    if (!key) {
      unmatched.push({ blank, context: ctx, reason: isEmail(blank) ? "no Configuration contact for this mailbox" : /^\d+$/.test(blank) ? "a number with no Configuration setting here; edit it in the policy text" : "the wording does not say which value it needs" });
      return whole;
    }
    replaced.push({ blank, key, context: ctx });
    return `{{${key}}}`;
  });
  return { template, replaced, unmatched, unknownBlanks: [...new Set(unmatched.map((u) => u.blank))] };
}

/** Bracketed blanks still in a template (not yet linked to a field). */
export function legacyBlanks(template: string): string[] {
  return [...new Set([...template.matchAll(BLANK)].map((m) => (m[1] ?? m[2] ?? "").trim()).filter((b) => b && !/^\{\{/.test(b)))];
}
/** Swaps the first occurrence of one blank (with or without its highlight span) for a field. */
export function replaceBlank(template: string, blank: string, key: string): string {
  const esc = blank.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return template.replace(new RegExp(`<span class="ph">\\s*\\[${esc}\\]\\s*</span>|\\[${esc}\\]`), `{{${key}}}`);
}
/** Kept for callers that only need one blank's key from its wording. */
export const keyForBlank = (blank: string) => BY_WORDING.find((r) => r.test.test(blank.trim()))?.key ?? null;

/**
 * Best field for a blank the converter left alone, from the row it sits in (for the "Suggested" entry in the picker).
 * Member rows are counted so the second "Member (employee)" row suggests member 2.
 */
export function suggestFor(template: string, blank: string): string | null {
  const esc = blank.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`<span class="ph">\\s*\\[${esc}\\]\\s*</span>|\\[${esc}\\]`).exec(template);
  if (!m) return null;
  const at = m.index, rowStart = template.lastIndexOf("<tr", at);
  const inRow = rowStart >= 0 && rowStart > template.lastIndexOf("</tr>", at);
  const label = inRow ? text(template.slice(rowStart, at)) : text(template.slice(Math.max(0, at - 160), at));
  if (isEmail(blank)) return BY_MAILBOX.find((x) => x.test.test(blank))?.key ?? (/internal committee|\bic\b/i.test(label) ? "posh.ic.email" : null);
  if (/presiding/i.test(label)) return "posh.ic.presiding_officer.name";
  if (/external member/i.test(label)) return "posh.ic.external_member.name";
  if (/\bmember\b/i.test(label) && inRow) {
    const tableStart = template.lastIndexOf("<table", at);
    const before = template.slice(tableStart, rowStart);
    const n = (before.match(/<tr[^>]*>\s*<td[^>]*>[^<]*\bmember\b/gi) ?? []).filter((r) => !/external|presiding/i.test(r)).length + 1;
    return `posh.ic.members.${Math.min(n, 6)}.name`;
  }
  return BY_CONTEXT.find((r) => r.blank.test(blank) && r.context.test(label))?.key ?? BY_WORDING.find((r) => r.test.test(blank))?.key ?? null;
}
