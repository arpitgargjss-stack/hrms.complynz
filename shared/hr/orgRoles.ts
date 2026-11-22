/**
 * Named roles and committees set in Admin configuration: the POSH Internal Committee and single contacts
 * such as the grievance officer, DPO and HR contact. Each person is either an employee (picked from People)
 * or typed in (for example the external member of the Internal Committee).
 */
export type ContactRole = "grievance_officer" | "dpo" | "hr_contact" | "ethics_officer" | "ombudsperson" | "security_contact" | "ic_mailbox" | "whistleblower_form";
export type OrgRole = "posh_presiding" | "posh_member" | "posh_external" | ContactRole;
/**
 * Named contacts. "person" is someone picked from People or typed in; "mailbox" is just an e-mail address
 * (stored in email); "link" is a web address (stored in organisation, since it is not a person).
 */
export const CONTACT_ROLES: { key: ContactRole; label: string; hint: string; kind: "person" | "mailbox" | "link" }[] = [
  { key: "grievance_officer", label: "Grievance officer", hint: "Named in privacy notices; answers employee and candidate grievances", kind: "person" },
  { key: "dpo", label: "Data protection officer", hint: "Contact for personal data requests under the DPDP Act", kind: "person" },
  { key: "hr_contact", label: "HR contact", hint: "Shown to employees as the first point of contact for HR questions", kind: "person" },
  { key: "ethics_officer", label: "Ethics officer", hint: "Receives whistleblower reports", kind: "person" },
  { key: "ombudsperson", label: "Independent ombudsperson", hint: "For concerns about the ethics officer or a founder", kind: "person" },
  { key: "ic_mailbox", label: "Internal Committee mailbox", hint: "Shared e-mail for POSH complaints", kind: "mailbox" },
  { key: "security_contact", label: "Security incident mailbox", hint: "Where to report phishing, lost devices and data leaks", kind: "mailbox" },
  { key: "whistleblower_form", label: "Anonymous reporting form", hint: "Web link for anonymous whistleblower reports", kind: "link" },
];
export type Gender = "female" | "male" | "other" | "undisclosed";
export type Person = { employeeId: string | null; name: string; email: string | null; phone: string | null; designation: string | null; organisation: string | null; gender: Gender };
export type Committee = { presiding: Person | null; members: Person[]; external: Person | null; termStart: string | null; termEnd: string | null };
export type Check = { key: string; ok: boolean; label: string; detail: string };

const MAX_TERM_YEARS = 3;
const iso = /^\d{4}-\d{2}-\d{2}$/;
/** Adds whole years to a YYYY-MM-DD date. */
const addYears = (d: string, n: number) => `${Number(d.slice(0, 4)) + n}${d.slice(4)}`;

/**
 * Checks the POSH Internal Committee against section 4 of the POSH Act, 2013:
 * a presiding officer who is a woman employee, at least 2 employee members, 1 external member,
 * at least 4 people in all, at least half of them women, and a term of no more than 3 years.
 */
export function checkPoshCommittee(c: Committee, today: string): Check[] {
  const all = [c.presiding, ...c.members, c.external].filter((p): p is Person => !!p && !!p.name.trim());
  const women = all.filter((p) => p.gender === "female").length;
  const names = all.map((p) => (p.employeeId ?? p.name.trim().toLowerCase()));
  const termOk = !!c.termStart && !!c.termEnd && iso.test(c.termStart) && iso.test(c.termEnd) && c.termEnd > c.termStart && c.termEnd <= addYears(c.termStart, MAX_TERM_YEARS);
  return [
    { key: "presiding", ok: !!c.presiding?.name.trim() && !!c.presiding.employeeId && c.presiding.gender === "female", label: "Presiding officer",
      detail: !c.presiding?.name.trim() ? "Not set" : !c.presiding.employeeId ? "Must be an employee" : c.presiding.gender !== "female" ? "Must be a woman employee" : c.presiding.name },
    { key: "members", ok: c.members.filter((m) => m.name.trim() && m.employeeId).length >= 2, label: "At least 2 employee members",
      detail: `${c.members.filter((m) => m.name.trim() && m.employeeId).length} employee members` },
    { key: "external", ok: !!c.external?.name.trim(), label: "One external member", detail: c.external?.name.trim() ? c.external.name : "Not set" },
    { key: "size", ok: all.length >= 4, label: "At least 4 members in all", detail: `${all.length} in all` },
    { key: "women", ok: all.length > 0 && women * 2 >= all.length, label: "At least half are women", detail: `${women} of ${all.length}` },
    { key: "unique", ok: new Set(names).size === names.length, label: "No one listed twice", detail: new Set(names).size === names.length ? "OK" : "The same person is listed more than once" },
    { key: "term", ok: termOk, label: `Term set, up to ${MAX_TERM_YEARS} years`,
      detail: !c.termStart || !c.termEnd ? "Start and end dates not set" : !termOk ? `End must be after start and within ${MAX_TERM_YEARS} years` : c.termEnd < today ? `Ended on ${c.termEnd}; reconstitute the committee` : `${c.termStart} to ${c.termEnd}` },
    { key: "current", ok: !!c.termEnd && c.termEnd >= today, label: "Term is current", detail: !c.termEnd ? "No end date" : c.termEnd < today ? `Expired on ${c.termEnd}` : `Runs until ${c.termEnd}` },
  ];
}
export const committeeReady = (c: Committee, today: string) => checkPoshCommittee(c, today).every((x) => x.ok);
