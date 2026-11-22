/**
 * Turns a policy published before templates existed (plain HTML with "[Name]"-style blanks) into a template with
 * placeholders, so it fills in from Configuration like any other policy. Only bracketed blanks whose wording clearly
 * names a known value are replaced; anything else is left as written and reported, so nothing is guessed silently.
 * Running it again on its own output changes nothing.
 */
export type LegacyResult = { template: string; replaced: { blank: string; key: string }[]; unknownBlanks: string[] };

type Rule = { test: RegExp; key: string };
// Order matters: the more specific wording comes first.
const RULES: Rule[] = [
  { test: /presiding.*(e-?mail|contact)|(e-?mail|contact).*presiding/i, key: "posh.ic.presiding_officer.email" },
  { test: /presiding/i, key: "posh.ic.presiding_officer.name" },
  { test: /external.*(organi[sz]ation|ngo)|(organi[sz]ation|ngo).*external|^ngo|ngo name/i, key: "posh.ic.external_member.organisation" },
  { test: /external/i, key: "posh.ic.external_member.name" },
  { test: /(committee|ic|icc)\s*members?|members? of the (internal )?committee|member names|members list/i, key: "posh.ic.members" },
  { test: /(term|valid).*(start|from)|(start|from).*term|effective from|date of constitution/i, key: "posh.ic.term_start" },
  { test: /(term|valid).*(end|till|until|to)|(end|expiry).*term/i, key: "posh.ic.term_end" },
  { test: /grievance.*(e-?mail|contact)|(e-?mail|contact).*grievance/i, key: "contacts.grievance_officer.email" },
  { test: /grievance/i, key: "contacts.grievance_officer.name" },
  { test: /(dpo|data protection).*(e-?mail|contact)|(e-?mail|contact).*(dpo|data protection)/i, key: "contacts.dpo.email" },
  { test: /\bdpo\b|data protection officer/i, key: "contacts.dpo.name" },
  { test: /\bhr\b.*(e-?mail|contact e-?mail)|(e-?mail).*\bhr\b/i, key: "contacts.hr_contact.email" },
  { test: /\bhr\b.*(manager|contact|head|person|name)|hr manager|human resources/i, key: "contacts.hr_contact.name" },
  { test: /signatory.*(designation|title)|designation of (the )?signatory/i, key: "company.signatory_designation" },
  { test: /signatory|authori[sz]ed (signatory|person)/i, key: "company.signatory_name" },
  { test: /\bcin\b/i, key: "company.cin" },
  { test: /registered (office )?address|company address|office address/i, key: "company.registered_address" },
  { test: /company('s)? (legal )?name|name of (the )?company|legal name|employer name|organi[sz]ation name/i, key: "company.legal_name" },
  { test: /company e-?mail|official e-?mail/i, key: "company.email" },
  { test: /casual leave/i, key: "leave.casual.days" },
  { test: /sick leave/i, key: "leave.sick.days" },
];

export function keyForBlank(blank: string): string | null {
  const t = blank.trim();
  return RULES.find((r) => r.test.test(t))?.key ?? null;
}

/** Replaces recognised [blanks] with {{placeholders}}. Text already inside {{…}} and our own preview marks are left alone. */
export function convertLegacyHtml(html: string): LegacyResult {
  const replaced: LegacyResult["replaced"] = [], unknown = new Set<string>();
  const template = html.replace(/\[([^\]\[<>{}\n]{2,80})\]/g, (whole, inner: string) => {
    const key = keyForBlank(inner);
    if (!key) { unknown.add(inner.trim()); return whole; }
    replaced.push({ blank: inner.trim(), key });
    return `{{${key}}}`;
  });
  return { template, replaced, unknownBlanks: [...unknown] };
}
