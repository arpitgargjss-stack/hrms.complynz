import { Router } from "express";
import { z } from "zod";
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { wrap, parse, HttpError } from "./util";
import { logAudit } from "../lib/audit";
import { digest } from "../lib/auditTrim";
import { need, istDate, dateStr } from "../lib/routeHelpers";
import { CONTACT_ROLES, checkPoshCommittee, type Committee, type OrgRole, type Person } from "../../shared/hr/orgRoles";

/**
 * Admin configuration, phase 1: the POSH Internal Committee and named contacts (grievance officer, DPO, HR contact).
 * HR admin, finance admin and super admin can read and change these (settings.manage). Every change is audited with before and after values.
 */
const r = Router();
const A = schema;
const gate = (req: Parameters<typeof need>[0]) => need(req, "settings.manage", "all");
type Row = typeof A.orgRoles.$inferSelect;

const toPerson = (x: Row): Person => ({ employeeId: x.employeeId, name: x.name, email: x.email, phone: x.phone, designation: x.designation, organisation: x.organisation, gender: x.gender as Person["gender"] });
export async function loadCommittee(): Promise<Committee> {
  const rows = await db.select().from(A.orgRoles).where(inArray(A.orgRoles.role, ["posh_presiding", "posh_member", "posh_external"])).orderBy(asc(A.orgRoles.position));
  const presiding = rows.find((x) => x.role === "posh_presiding");
  const any = rows[0];
  return { presiding: presiding ? toPerson(presiding) : null, members: rows.filter((x) => x.role === "posh_member").map(toPerson),
    external: (() => { const e = rows.find((x) => x.role === "posh_external"); return e ? toPerson(e) : null; })(),
    termStart: any?.termStart ?? null, termEnd: any?.termEnd ?? null };
}
async function loadContacts() {
  const rows = await db.select().from(A.orgRoles).where(inArray(A.orgRoles.role, CONTACT_ROLES.map((c) => c.key)));
  return Object.fromEntries(CONTACT_ROLES.map((c) => { const x = rows.find((y) => y.role === c.key); return [c.key, x ? toPerson(x) : null]; })) as Record<string, Person | null>;
}

r.get("/config", wrap(async (req, res) => {
  gate(req);
  const [committee, contacts, people, company] = await Promise.all([
    loadCommittee(), loadContacts(),
    db.select({ id: A.employees.id, name: A.employees.fullName, email: A.employees.workEmail, phone: A.employees.phone, gender: A.employees.gender, designation: A.designations.name, status: A.employees.status })
      .from(A.employees).leftJoin(A.designations, eq(A.designations.id, A.employees.designationId)).where(inArray(A.employees.status, ["active", "notice"])).orderBy(asc(A.employees.fullName)),
    db.select({ id: A.companyProfile.id }).from(A.companyProfile).limit(1),
  ]);
  const today = istDate();
  res.json({ today, committee, checks: checkPoshCommittee(committee, today), contacts, contactRoles: CONTACT_ROLES, people, companySet: company.length > 0,
    canEditCompany: req.actor!.roles.has("super_admin"), canViewCompany: req.actor!.roles.has("hr_admin") });
}));

const gender = z.enum(["female", "male", "other", "undisclosed"]);
const person = z.object({
  employeeId: z.string().uuid().nullable(), name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(200).nullable(),
  phone: z.string().trim().max(30).nullable(), designation: z.string().trim().max(120).nullable(), organisation: z.string().trim().max(160).nullable(), gender,
}).strict();
const committeeSchema = z.object({ presiding: person.nullable(), members: z.array(person).max(12), external: person.nullable(), termStart: dateStr.nullable(), termEnd: dateStr.nullable() }).strict();

/** Fills name, email and designation from People for employee seats, so the committee always matches the employee record. */
async function resolve(p: Person): Promise<Person> {
  if (!p.employeeId) return p;
  const [e] = await db.select({ name: A.employees.fullName, email: A.employees.workEmail, designation: A.designations.name, status: A.employees.status })
    .from(A.employees).leftJoin(A.designations, eq(A.designations.id, A.employees.designationId)).where(eq(A.employees.id, p.employeeId)).limit(1);
  if (!e || e.status === "exited") throw new HttpError(400, `${p.name} is not a current employee`);
  return { ...p, name: e.name, email: e.email, designation: p.designation || e.designation };
}
async function replace(roles: OrgRole[], seats: { role: OrgRole; p: Person; i: number; termStart?: string | null; termEnd?: string | null }[], by: string) {
  await db.transaction(async (tx) => {
    await tx.delete(A.orgRoles).where(inArray(A.orgRoles.role, roles));
    if (seats.length) await tx.insert(A.orgRoles).values(seats.map((s) => ({ role: s.role, employeeId: s.p.employeeId, name: s.p.name, email: s.p.email, phone: s.p.phone, designation: s.p.designation, organisation: s.p.organisation, gender: s.p.gender, termStart: s.termStart ?? null, termEnd: s.termEnd ?? null, position: s.i, createdBy: by })));
  });
}

r.put("/config/posh-committee", wrap(async (req, res) => {
  gate(req);
  const b = parse(committeeSchema, req.body);
  const before = await loadCommittee();
  const presiding = b.presiding ? await resolve(b.presiding) : null;
  const members = await Promise.all(b.members.map(resolve));
  const external = b.external ? { ...b.external, employeeId: null } : null; // the external member is never an employee
  const t = { termStart: b.termStart, termEnd: b.termEnd };
  await replace(["posh_presiding", "posh_member", "posh_external"], [
    ...(presiding ? [{ role: "posh_presiding" as const, p: presiding, i: 0, ...t }] : []),
    ...members.map((p, i) => ({ role: "posh_member" as const, p, i: i + 1, ...t })),
    ...(external ? [{ role: "posh_external" as const, p: external, i: 99, ...t }] : []),
  ], req.actor!.email);
  const after = await loadCommittee();
  const shape = (c: Committee) => ({ presiding: !!c.presiding, members: c.members.length, external: !!c.external, termStart: c.termStart, termEnd: c.termEnd, sha256: digest(c) });
  await logAudit(req.actor!.email, "config.posh_committee.update", "org_roles", "posh_committee", { before: shape(before), after: shape(after) });
  res.json({ committee: after, checks: checkPoshCommittee(after, istDate()) });
}));

const contactsSchema = z.object(Object.fromEntries(CONTACT_ROLES.map((c) => [c.key, person.nullable()])) as Record<string, z.ZodNullable<typeof person>>).strict();
r.put("/config/contacts", wrap(async (req, res) => {
  gate(req);
  const b = parse(contactsSchema, req.body);
  const before = await loadContacts();
  const seats = await Promise.all(CONTACT_ROLES.filter((c) => b[c.key]).map(async (c, i) => ({ role: c.key, p: await resolve(b[c.key]!), i })));
  await replace(CONTACT_ROLES.map((c) => c.key), seats, req.actor!.email);
  const after = await loadContacts();
  await logAudit(req.actor!.email, "config.contacts.update", "org_roles", "contacts", { changed: CONTACT_ROLES.map((c) => c.key).filter((k) => digest(before[k]) !== digest(after[k])), set: CONTACT_ROLES.map((c) => c.key).filter((k) => after[k]) });
  res.json(after);
}));

export default r;
