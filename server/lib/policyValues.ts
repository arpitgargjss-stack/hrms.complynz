import { asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { COMPANY_DEFAULTS, type CompanyProfile } from "../../shared/hr/letters";
import { formatINR } from "../../shared/hr/money";
import { MEMBER_SEATS, type Values } from "../../shared/hr/placeholders";
import { CONTACT_ROLES, type Person } from "../../shared/hr/orgRoles";
import { loadCommittee } from "../routes/config";

const A = schema;
const dateText = (d: string | null) => (d ? new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : null);
const days = (halfDays: number) => (halfDays % 2 ? `${halfDays / 2}` : String(halfDays / 2));

/** Current value of every placeholder, read from Admin configuration and the existing settings. Empty values come back as null. */
export async function placeholderValues(): Promise<Values> {
  const [[co], committee, contacts, leave, [reimb]] = await Promise.all([
    db.select().from(A.companyProfile).orderBy(desc(A.companyProfile.id)).limit(1),
    loadCommittee(),
    db.select().from(A.orgRoles).where(inArray(A.orgRoles.role, CONTACT_ROLES.map((c) => c.key))),
    db.select().from(A.leaveTypes).where(eq(A.leaveTypes.active, true)).orderBy(asc(A.leaveTypes.name)),
    db.select().from(A.reimbursementPolicy).orderBy(desc(A.reimbursementPolicy.id)).limit(1),
  ]);
  const c: CompanyProfile = { ...COMPANY_DEFAULTS, ...((co?.settings ?? {}) as Partial<CompanyProfile>) };
  const v = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);
  const contact = (role: string) => contacts.find((x) => x.role === role);
  const seat = (p: Person, role: string) => [role, p.name, p.designation ?? p.organisation ?? "", [p.email, p.phone].filter(Boolean).join(", ")];
  const members = [
    ...(committee.presiding ? [seat(committee.presiding, "Presiding Officer")] : []),
    ...committee.members.map((m) => seat(m, "Member")),
    ...(committee.external ? [seat(committee.external, "External member")] : []),
  ];
  const r = (reimb?.settings ?? null) as { billRequiredAbovePaise?: number; managerApprovalAbovePaise?: number; ceoApprovalAbovePaise?: number; submitWithinDays?: number } | null;
  const money = (p: number | undefined) => (typeof p === "number" ? formatINR(p) : null);
  const lt = (key: string) => leave.find((l) => l.key === key);
  return {
    "company.legal_name": v(c.legalName), "company.brand_name": v(c.brandName), "company.registered_address": v(c.registeredAddress),
    "company.cin": v(c.cin), "company.email": v(c.email), "company.website": v(c.website),
    "company.signatory_name": v(c.signatoryName), "company.signatory_designation": v(c.signatoryDesignation),
    "posh.ic.presiding_officer.name": v(committee.presiding?.name), "posh.ic.presiding_officer.email": v(committee.presiding?.email),
    "posh.ic.presiding_officer.designation": v(committee.presiding?.designation), "posh.ic.presiding_officer.phone": v(committee.presiding?.phone),
    "posh.ic.external_member.email": v(committee.external?.email),
    ...Object.fromEntries(Array.from({ length: MEMBER_SEATS }, (_, i) => { const m = committee.members[i];
      return [[`posh.ic.members.${i + 1}.name`, v(m?.name)], [`posh.ic.members.${i + 1}.email`, v(m?.email)], [`posh.ic.members.${i + 1}.designation`, v(m?.designation)]]; }).flat()),
    ...Object.fromEntries(["grievance_officer", "dpo", "hr_contact", "ethics_officer", "ombudsperson"].flatMap((k) => [[`contacts.${k}.designation`, v(contact(k)?.designation)], [`contacts.${k}.phone`, v(contact(k)?.phone)]])),
    "posh.ic.external_member.name": v(committee.external?.name), "posh.ic.external_member.organisation": v(committee.external?.organisation),
    "posh.ic.members": members.length ? { headers: ["Role", "Name", "Designation or organisation", "Contact"], rows: members } : null,
    "posh.ic.term_start": dateText(committee.termStart), "posh.ic.term_end": dateText(committee.termEnd),
    "contacts.grievance_officer.name": v(contact("grievance_officer")?.name), "contacts.grievance_officer.email": v(contact("grievance_officer")?.email),
    "contacts.dpo.name": v(contact("dpo")?.name), "contacts.dpo.email": v(contact("dpo")?.email),
    "contacts.hr_contact.name": v(contact("hr_contact")?.name), "contacts.hr_contact.email": v(contact("hr_contact")?.email),
    "contacts.ethics_officer.name": v(contact("ethics_officer")?.name), "contacts.ethics_officer.email": v(contact("ethics_officer")?.email),
    "contacts.ombudsperson.name": v(contact("ombudsperson")?.name), "contacts.ombudsperson.email": v(contact("ombudsperson")?.email),
    "contacts.security.email": v(contact("security_contact")?.email), "posh.ic.email": v(contact("ic_mailbox")?.email),
    "whistleblower.form_link": v(contact("whistleblower_form")?.organisation),
    "leave.types": leave.length ? { headers: ["Leave type", "Days a year", "Carry forward", "Paid"], rows: leave.map((l) => [l.name, days(l.annualQuotaHalfDays), days(l.carryForwardHalfDays), l.paid ? "Yes" : "No"]) } : null,
    "leave.casual.days": lt("casual") ? days(lt("casual")!.annualQuotaHalfDays) : null,
    "leave.sick.days": lt("sick") ? days(lt("sick")!.annualQuotaHalfDays) : null,
    "leave.paternity.days": lt("paternity") ? days(lt("paternity")!.annualQuotaHalfDays) : null,
    "leave.bereavement.days": lt("bereavement") ? days(lt("bereavement")!.annualQuotaHalfDays) : null,
    "reimbursement.bill_required_above": money(r?.billRequiredAbovePaise), "reimbursement.manager_approval_above": money(r?.managerApprovalAbovePaise),
    "reimbursement.ceo_approval_above": money(r?.ceoApprovalAbovePaise), "reimbursement.submit_within_days": typeof r?.submitWithinDays === "number" ? String(r.submitWithinDays) : null,
  };
}

/** Text placeholder values only (tables dropped), for filling plain-text emails. */
export async function textPlaceholderValues(): Promise<Record<string, string | null>> {
  const v = await placeholderValues();
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, typeof x === "string" ? x : null]));
}
