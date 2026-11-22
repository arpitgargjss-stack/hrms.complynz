import { Router, type Request } from "express";
import { z } from "zod";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { env } from "../env";
import { wrap, parse, HttpError } from "./util";
import { logAudit } from "../lib/audit";
import { encryptField, decryptField, maskTail } from "../lib/crypto";
import { saveFile, readFileBytes } from "../lib/files";
import { sanitizeHtml } from "../lib/sanitizeHtml";
import { renderLive } from "../lib/policyRender";
import { placeholderValues } from "../lib/policyValues";
import { sendConsentEvent } from "../lib/consentClient";
import { canSeeVibePhoto, personOf } from "../lib/vibe";
import { scopeFor, canAccess, type Capability, type Scope } from "../../shared/hr/access";
import { nextEmployeeCode, CONSENT_PURPOSES, upcomingEvents } from "../../shared/hr/misc";
import { LOGIN_PURPOSE, onLoginConsent } from "../lib/loginDays";
import { INDIAN_STATES } from "../../shared/hr/presets";
import { missingProfileFields } from "../../shared/hr/profile";
import { workFieldChanges } from "../../shared/hr/employeeAudit";
import type { Role } from "../../shared/hr/access";
import type { Actor } from "../middleware/auth";

export { sanitizeHtml };
const r = Router();

// ---------- helpers ----------
const S = schema;
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
const idParam = (req: Request, name = "id") => parse(uuid, req.params[name]);
const actorOf = (req: Request): Actor => req.actor!;
const scope = (req: Request, cap: Capability): Scope => scopeFor(actorOf(req).roles, cap);
const isAdmin = (req: Request) => actorOf(req).roles.has("hr_admin");
function need(req: Request, cap: Capability, min: Scope = "all"): Scope {
  const s = scope(req, cap);
  const rank = { none: 0, own: 1, reports: 2, all: 3 } as const;
  if (rank[s] < rank[min]) throw new HttpError(403, "Not allowed");
  return s;
}
const needEmployee = (req: Request): string => {
  const id = actorOf(req).employeeId;
  if (!id) throw new HttpError(404, "No employee record is linked to this login");
  return id;
};
function pgCode(e: unknown): string | undefined {
  const x = e as { code?: string; cause?: { code?: string } };
  return x?.code ?? x?.cause?.code;
}
async function uniq<T>(p: Promise<T>, msg = "Already exists"): Promise<T> {
  try { return await p; } catch (e) { if (pgCode(e) === "23505") throw new HttpError(409, msg); throw e; }
}
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const nullable = <T extends z.ZodTypeAny>(t: T) => t.nullable().optional();

// =====================================================================
// Org config: departments, designations, locations
// =====================================================================
const nameField = z.string().trim().min(1).max(120);
const coord = (min: number, max: number) =>
  z.union([z.number(), z.string().trim().min(1)]).transform((v) => Number(v)).refine((n) => Number.isFinite(n) && n >= min && n <= max, `must be between ${min} and ${max}`).transform((n) => String(n));

function orgCrud(path: string, label: string, table: any, refCol: any, createSchema: z.ZodObject<any>) {
  r.get(`/${path}`, wrap(async (_req, res) => { res.json(await db.select().from(table).orderBy(asc(table.name))); }));
  r.post(`/${path}`, wrap(async (req, res) => {
    need(req, "org.configure");
    const body = parse(createSchema, req.body);
    const [row] = (await uniq((db.insert(table).values(body) as any).returning(), `${label} name already exists`)) as any[];
    await logAudit(actorOf(req).email, `${label}.create`, label, row.id, { name: row.name });
    res.status(201).json(row);
  }));
  r.patch(`/${path}/:id`, wrap(async (req, res) => {
    need(req, "org.configure");
    const id = idParam(req);
    const body = parse(createSchema.partial().strict(), req.body);
    if (!Object.keys(body).length) throw new HttpError(400, "Nothing to update");
    const [row] = (await uniq((db.update(table).set(body) as any).where(eq(table.id, id)).returning(), `${label} name already exists`)) as any[];
    if (!row) throw new HttpError(404, "Not found");
    await logAudit(actorOf(req).email, `${label}.update`, label, id, { fields: Object.keys(body) });
    res.json(row);
  }));
  r.delete(`/${path}/:id`, wrap(async (req, res) => {
    need(req, "org.configure");
    const id = idParam(req);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(S.employees).where(eq(refCol, id));
    if (n > 0) throw new HttpError(409, `In use by ${n} employee(s); reassign them first`);
    const [row] = (await (db.delete(table) as any).where(eq(table.id, id)).returning()) as any[];
    if (!row) throw new HttpError(404, "Not found");
    await logAudit(actorOf(req).email, `${label}.delete`, label, id, { name: row.name });
    res.json({ ok: true });
  }));
}
orgCrud("departments", "department", S.departments, S.employees.departmentId, z.object({ name: nameField }));
orgCrud("designations", "designation", S.designations, S.employees.designationId, z.object({ name: nameField, level: z.number().int().min(0).max(50).optional() }));
orgCrud("locations", "location", S.locations, S.employees.locationId, z.object({
  name: nameField, address: nullable(z.string().trim().max(500)),
  lat: nullable(coord(-90, 90)), lng: nullable(coord(-180, 180)), radiusM: z.number().int().min(20).max(5000).optional(),
  isRemote: z.boolean().optional(), state: nullable(z.enum(INDIAN_STATES)),
}));

// =====================================================================
// Employees
// =====================================================================
type EmpRow = typeof S.employees.$inferSelect;
interface Lookups { dept: Map<string, string>; desig: Map<string, string>; loc: Map<string, string> }
async function lookups(): Promise<Lookups> {
  const [d, g, l] = await Promise.all([db.select().from(S.departments), db.select().from(S.designations), db.select().from(S.locations)]);
  return { dept: new Map(d.map((x) => [x.id, x.name])), desig: new Map(g.map((x) => [x.id, x.name])), loc: new Map(l.map((x) => [x.id, x.name])) };
}
/** Directory card: the only shape non-privileged readers get. */
const card = (e: EmpRow, L: Lookups) => ({
  id: e.id, code: e.code, fullName: e.fullName, designation: e.designationId ? L.desig.get(e.designationId) ?? null : null,
  department: e.departmentId ? L.dept.get(e.departmentId) ?? null : null, workEmail: e.workEmail, photoFileId: e.photoFileId, managerId: e.managerId,
});
/** Work details (managers of the person, hr_admin). No personal/ID/bank data. */
const work = (e: EmpRow, L: Lookups) => ({
  ...card(e, L), departmentId: e.departmentId, designationId: e.designationId, locationId: e.locationId,
  location: e.locationId ? L.loc.get(e.locationId) ?? null : null, joiningDate: e.joiningDate, employmentType: e.employmentType,
  status: e.status, lastWorkingDay: e.lastWorkingDay,
});
/** Personal fields: owner and hr_admin only. */
const personal = (e: EmpRow) => ({
  personalEmail: e.personalEmail, phone: e.phone, dob: e.dob, gender: e.gender, currentAddress: e.currentAddress,
  emergencyContactName: e.emergencyContactName, emergencyContactRelation: e.emergencyContactRelation, emergencyContactPhone: e.emergencyContactPhone,
  profileCompletedAt: e.profileCompletedAt,
});
/** Stamp the first-login profile as complete once every required field is filled. Returns the (possibly updated) row. */
export async function markProfileIfComplete(row: EmpRow): Promise<EmpRow> {
  if (row.profileCompletedAt || missingProfileFields(row).length) return row;
  const [u] = await db.update(S.employees).set({ profileCompletedAt: new Date() }).where(eq(S.employees.id, row.id)).returning();
  return u ?? row;
}
function safeMask(enc: string | null): string | null {
  if (!enc) return null;
  try { return maskTail(decryptField(enc), 4); } catch { return null; }
}
const bankView = (e: EmpRow) => ({
  panMasked: safeMask(e.panEnc), bankName: e.bankName, ifsc: e.ifsc, accountMasked: safeMask(e.accountEnc),
});

r.get("/employees", wrap(async (req, res) => {
  const a = actorOf(req);
  const s = scope(req, "people.read_work");
  const L = await lookups();
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  if (s === "all") {
    const rows = await db.select().from(S.employees).where(status ? eq(S.employees.status, status) : undefined).orderBy(asc(S.employees.code));
    return res.json({ scope: s, employees: rows.map((e) => ({ ...work(e, L), ...personal(e) })) });
  }
  const rows = await db.select().from(S.employees).where(ne(S.employees.status, "exited")).orderBy(asc(S.employees.fullName));
  if (s === "reports") {
    return res.json({ scope: s, employees: rows.map((e) => (a.directReportIds.includes(e.id) ? work(e, L) : card(e, L))) });
  }
  res.json({ scope: s, employees: rows.map((e) => card(e, L)) });
}));

r.get("/employees/:id", wrap(async (req, res) => {
  const a = actorOf(req);
  const id = idParam(req);
  const [e] = await db.select().from(S.employees).where(eq(S.employees.id, id)).limit(1);
  if (!e) throw new HttpError(404, "Not found");
  const L = await lookups();
  const own = a.employeeId === id;
  const admin = scope(req, "people.write") === "all";
  if (admin || own) {
    const out = { ...work(e, L), ...personal(e), ...bankView(e), access: own ? "own" : "hr_admin" };
    if (admin && !own && (e.panEnc || e.accountEnc)) await logAudit(a.email, "employee.read_sensitive", "employee", id, { fields: ["pan_masked", "bank"] });
    return res.json(out);
  }
  const s = scope(req, "people.read_work");
  if (s !== "none" && canAccess(s, a, id)) return res.json({ ...work(e, L), access: "manager" });
  if (e.status === "exited") throw new HttpError(404, "Not found");
  res.json({ ...card(e, L), access: "directory" });
}));

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const panField = z.string().trim().toUpperCase().regex(PAN, "invalid PAN");
const ifscField = z.string().trim().toUpperCase().regex(IFSC, "invalid IFSC");
const accountField = z.string().trim().regex(/^\d{9,18}$/, "account number must be 9-18 digits");
const phoneField = z.string().trim().regex(/^\+?[0-9 \-]{7,16}$/, "invalid phone");
const domainEmail = z.string().trim().toLowerCase().email().refine((v) => v.endsWith("@" + env.STAFF_EMAIL_DOMAIN), `must be a @${env.STAFF_EMAIL_DOMAIN} address`);

const createEmployee = z.object({
  fullName: z.string().trim().min(1).max(160), workEmail: domainEmail,
  personalEmail: nullable(z.string().trim().toLowerCase().email()), phone: nullable(phoneField),
  dob: nullable(isoDate), gender: nullable(z.enum(["male", "female", "other", "undisclosed"])), joiningDate: isoDate,
  departmentId: nullable(uuid), designationId: nullable(uuid), locationId: nullable(uuid), managerId: nullable(uuid),
  employmentType: z.enum(["full_time", "part_time", "contract", "intern"]).optional(),
  pan: nullable(panField), bankName: nullable(z.string().trim().max(120)), accountNumber: nullable(accountField), ifsc: nullable(ifscField),
});

async function assertRefs(b: { departmentId?: string | null; designationId?: string | null; locationId?: string | null; managerId?: string | null }) {
  const chk = async (id: string | null | undefined, table: any, label: string) => {
    if (!id) return;
    const [x] = await db.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1);
    if (!x) throw new HttpError(400, `Unknown ${label}`);
  };
  await chk(b.departmentId, S.departments, "department");
  await chk(b.designationId, S.designations, "designation");
  await chk(b.locationId, S.locations, "location");
  await chk(b.managerId, S.employees, "manager");
}

r.post("/employees", wrap(async (req, res) => {
  need(req, "people.write");
  const b = parse(createEmployee, req.body);
  await assertRefs(b);
  const codes = (await db.select({ code: S.employees.code }).from(S.employees)).map((x) => x.code);
  const [row] = await uniq(db.insert(S.employees).values({
    code: nextEmployeeCode(codes), workEmail: b.workEmail, fullName: b.fullName, personalEmail: b.personalEmail ?? null, phone: b.phone ?? null,
    dob: b.dob ?? null, gender: b.gender ?? null, joiningDate: b.joiningDate, departmentId: b.departmentId ?? null,
    designationId: b.designationId ?? null, locationId: b.locationId ?? null, managerId: b.managerId ?? null,
    employmentType: b.employmentType ?? "full_time", panEnc: b.pan ? encryptField(b.pan) : null,
    bankName: b.bankName ?? null, accountEnc: b.accountNumber ? encryptField(b.accountNumber) : null, ifsc: b.ifsc ?? null,
  }).returning(), "An employee with this work email already exists (or the code collided; retry)");
  await logAudit(actorOf(req).email, "employee.create", "employee", row.id, { code: row.code, hasPan: !!b.pan, hasBank: !!b.accountNumber });
  const L = await lookups();
  res.status(201).json({ ...work(row, L), ...personal(row), ...bankView(row) });
}));

const pastDate = isoDate.refine((v) => v >= "1900-01-01" && v <= istToday(), "must be a past date");
const profileFields = {
  dob: nullable(pastDate), gender: nullable(z.enum(["male", "female", "other", "undisclosed"])),
  currentAddress: nullable(z.string().trim().min(1).max(500)),
  emergencyContactName: nullable(z.string().trim().min(1).max(160)), emergencyContactRelation: nullable(z.string().trim().min(1).max(60)),
  emergencyContactPhone: nullable(phoneField),
};
const adminPatch = z.object({
  fullName: z.string().trim().min(1).max(160), workEmail: domainEmail, personalEmail: nullable(z.string().trim().toLowerCase().email()),
  phone: nullable(phoneField), joiningDate: isoDate,
  departmentId: nullable(uuid), designationId: nullable(uuid), locationId: nullable(uuid),
  employmentType: z.enum(["full_time", "part_time", "contract", "intern"]), status: z.enum(["active", "notice", "exited"]), lastWorkingDay: nullable(isoDate),
  pan: nullable(panField), bankName: nullable(z.string().trim().max(120)), accountNumber: nullable(accountField), ifsc: nullable(ifscField),
  ...profileFields,
}).partial().strict();
const selfPatch = z.object({
  ...profileFields,
  phone: nullable(phoneField), personalEmail: nullable(z.string().trim().toLowerCase().email()),
  bankName: nullable(z.string().trim().max(120)), accountNumber: nullable(accountField), ifsc: nullable(ifscField),
}).partial().strict();

r.patch("/employees/:id", wrap(async (req, res) => {
  const a = actorOf(req);
  const id = idParam(req);
  const admin = scope(req, "people.write") === "all";
  const own = a.employeeId === id;
  if (!admin && !own) throw new HttpError(403, "Not allowed");
  const b = parse(admin ? adminPatch : selfPatch, req.body) as z.infer<typeof adminPatch>;
  if (!Object.keys(b).length) throw new HttpError(400, "Nothing to update");
  await assertRefs(b);
  const { pan, accountNumber, ...rest } = b;
  const set: Partial<typeof S.employees.$inferInsert> = { ...rest };
  if (pan !== undefined) set.panEnc = pan ? encryptField(pan) : null;
  if (accountNumber !== undefined) set.accountEnc = accountNumber ? encryptField(accountNumber) : null;
  const [before] = await db.select().from(S.employees).where(eq(S.employees.id, id)).limit(1);
  if (!before) throw new HttpError(404, "Not found");
  const emailChange = b.workEmail !== undefined && b.workEmail !== before.workEmail ? { from: before.workEmail, to: b.workEmail } : null;
  const updated = await uniq(db.transaction(async (tx) => {
    const [u] = await tx.update(S.employees).set(set).where(eq(S.employees.id, id)).returning();
    // Login and roles are keyed by work email: carry the person's roles over so they keep their access.
    if (u && emailChange) await tx.update(S.userRoles).set({ email: emailChange.to }).where(eq(S.userRoles.email, emailChange.from));
    return u;
  }), "Work email already in use");
  if (!updated) throw new HttpError(404, "Not found");
  const row = await markProfileIfComplete(updated);
  const touchesSensitive = pan !== undefined || accountNumber !== undefined || b.ifsc !== undefined || b.bankName !== undefined;
  const L = await lookups();
  const changes: Record<string, { from: unknown; to: unknown; fromName?: string | null; toName?: string | null }> = workFieldChanges(before, updated);
  const names = { departmentId: L.dept, designationId: L.desig, locationId: L.loc } as const;
  for (const [k, m] of Object.entries(names)) {
    const c = changes[k];
    if (c) { c.fromName = c.from ? m.get(String(c.from)) ?? null : null; c.toName = c.to ? m.get(String(c.to)) ?? null : null; }
  }
  await logAudit(a.email, touchesSensitive ? "employee.update_sensitive" : "employee.update", "employee", id, {
    fields: Object.keys(b), by: admin && !own ? "hr_admin" : "self", ...(Object.keys(changes).length ? { changes } : {}),
    ...(emailChange ? { rolesMovedToNewEmail: true } : {}),
  });
  res.json({ ...work(row, L), ...personal(row), ...bankView(row) });
}));

// ---------- org chart ----------
r.get("/org-chart", wrap(async (_req, res) => {
  const L = await lookups();
  const rows = await db.select().from(S.employees).where(ne(S.employees.status, "exited")).orderBy(asc(S.employees.fullName));
  const nodes = rows.map((e) => ({ id: e.id, name: e.fullName, code: e.code, designation: e.designationId ? L.desig.get(e.designationId) ?? null : null, department: e.departmentId ? L.dept.get(e.departmentId) ?? null : null, managerId: e.managerId, photoFileId: e.photoFileId }));
  type Node = (typeof nodes)[number] & { children: Node[] };
  const byId = new Map<string, Node>(nodes.map((n) => [n.id, { ...n, children: [] }]));
  const tree: Node[] = [];
  for (const n of byId.values()) {
    const p = n.managerId ? byId.get(n.managerId) : undefined;
    if (p && p !== n) p.children.push(n); else tree.push(n);
  }
  res.json({ nodes, tree });
}));

// ---------- change reporting manager ----------
r.post("/employees/:id/manager", wrap(async (req, res) => {
  need(req, "people.write");
  const id = idParam(req);
  const b = parse(z.object({ managerId: z.string().uuid().nullable(), effectiveFrom: isoDate, reason: z.string().trim().min(1).max(500) }).strict(), req.body);
  const all = await db.select({ id: S.employees.id, managerId: S.employees.managerId }).from(S.employees);
  const byId = new Map(all.map((x) => [x.id, x.managerId]));
  if (!byId.has(id)) throw new HttpError(404, "Not found");
  if (b.managerId) {
    if (b.managerId === id) throw new HttpError(400, "An employee cannot report to themselves");
    if (!byId.has(b.managerId)) throw new HttpError(400, "Unknown manager");
    // walk up from the proposed manager; reaching the employee means the manager is a descendant
    const seen = new Set<string>();
    for (let cur: string | null | undefined = b.managerId; cur; cur = byId.get(cur)) {
      if (cur === id) throw new HttpError(400, "That would create a reporting cycle (new manager reports to this employee)");
      if (seen.has(cur)) break;
      seen.add(cur);
    }
  }
  const from = byId.get(id) ?? null;
  if (from === b.managerId) throw new HttpError(400, "Manager is unchanged");
  await db.transaction(async (tx) => {
    await tx.insert(S.managerChanges).values({ employeeId: id, fromManagerId: from, toManagerId: b.managerId, effectiveFrom: b.effectiveFrom, reason: b.reason, changedBy: actorOf(req).email });
    await tx.update(S.employees).set({ managerId: b.managerId }).where(eq(S.employees.id, id));
  });
  await logAudit(actorOf(req).email, "employee.manager_change", "employee", id, { from, to: b.managerId, effectiveFrom: b.effectiveFrom });
  res.json({ ok: true, employeeId: id, fromManagerId: from, toManagerId: b.managerId });
}));

r.get("/employees/:id/manager-history", wrap(async (req, res) => {
  const a = actorOf(req);
  const id = idParam(req);
  const s = scope(req, "people.read_work");
  if (!(s !== "none" && canAccess(s, a, id))) throw new HttpError(403, "Not allowed");
  res.json(await db.select().from(S.managerChanges).where(eq(S.managerChanges.employeeId, id)).orderBy(desc(S.managerChanges.createdAt)));
}));

// =====================================================================
// Documents and files
// =====================================================================
const SIG: Record<string, (b: Buffer) => boolean> = {
  "application/pdf": (b) => b.subarray(0, 5).toString("latin1") === "%PDF-",
  "image/png": (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8,
  "image/webp": (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
};
const docBody = z.object({
  kind: z.enum(["pan", "aadhaar", "photo"]), name: z.string().trim().min(1).max(200),
  mime: z.enum(["application/pdf", "image/png", "image/jpeg", "image/webp"]), dataBase64: z.string().min(8).max(15_000_000),
}).strict();

r.post("/employees/:id/documents", wrap(async (req, res) => {
  const a = actorOf(req);
  const id = idParam(req);
  if (!(a.employeeId === id || scope(req, "people.write") === "all")) throw new HttpError(403, "Not allowed");
  const b = parse(docBody, req.body);
  if (b.kind === "photo" && b.mime === "application/pdf") throw new HttpError(400, "Photo must be an image");
  const [e] = await db.select({ id: S.employees.id }).from(S.employees).where(eq(S.employees.id, id)).limit(1);
  if (!e) throw new HttpError(404, "Not found");
  const buf = Buffer.from(b.dataBase64.replace(/^data:[^,]*,/, ""), "base64");
  if (!buf.length) throw new HttpError(400, "Empty file");
  if (buf.length > 10 * 1024 * 1024) throw new HttpError(400, "File too large (max 10 MB)");
  if (!SIG[b.mime](buf)) throw new HttpError(400, "File content does not match the declared type");
  // Aadhaar and PAN images/PDFs are stored as-is. No text or number extraction is done anywhere.
  const f = await saveFile({ kind: b.kind, buf, name: b.name, mime: b.mime, uploadedBy: a.email, ownerEmployeeId: id });
  if (b.kind === "photo") {
    const [row] = await db.update(S.employees).set({ photoFileId: f.id }).where(eq(S.employees.id, id)).returning();
    if (row) await markProfileIfComplete(row);
  }
  await logAudit(a.email, "document.upload", "file", f.id, { kind: b.kind, ownerEmployeeId: id, sizeBytes: f.sizeBytes });
  res.status(201).json({ id: f.id, kind: f.kind, name: f.originalName, mime: f.mime, sizeBytes: f.sizeBytes, createdAt: f.createdAt });
}));

r.get("/employees/:id/documents", wrap(async (req, res) => {
  const a = actorOf(req);
  const id = idParam(req);
  if (!(a.employeeId === id || scope(req, "id_docs.read") === "all")) throw new HttpError(403, "Not allowed");
  const rows = await db.select().from(S.files).where(and(eq(S.files.ownerEmployeeId, id), inArray(S.files.kind, ["pan", "aadhaar", "photo"]))).orderBy(desc(S.files.createdAt));
  res.json(rows.map((f) => ({ id: f.id, kind: f.kind, name: f.originalName, mime: f.mime, sizeBytes: f.sizeBytes, createdAt: f.createdAt })));
}));

r.get("/files/:fileId", wrap(async (req, res) => {
  const a = actorOf(req);
  const fileId = idParam(req, "fileId");
  const [f] = await db.select().from(S.files).where(eq(S.files.id, fileId)).limit(1);
  if (!f) throw new HttpError(404, "Not found");
  const owner = !!f.ownerEmployeeId && f.ownerEmployeeId === a.employeeId;
  let allowed = false;
  let sensitive = false;
  if (f.kind === "photo") allowed = true;
  else if (f.kind === "vibe_photo") {
    // Vibe page snaps follow the owner's section audience and consent, not HR rights.
    const viewer = a.employeeId ? await personOf(a.employeeId) : null;
    allowed = await canSeeVibePhoto(viewer, f.ownerEmployeeId, f.id);
  }
  else if (f.kind === "pan" || f.kind === "aadhaar") {
    sensitive = true;
    const s = scope(req, "id_docs.read");
    allowed = s === "all" || (owner && s !== "none");
  } else if (f.kind === "bill") {
    const s = scope(req, "claims.read");
    allowed = owner || (s !== "none" && !!f.ownerEmployeeId && canAccess(s, a, f.ownerEmployeeId));
  } else {
    allowed = owner || a.roles.has("hr_admin") || (a.roles.has("finance_signatory") && ["signature", "stamp", "letter"].includes(f.kind));
  }
  if (!allowed) throw new HttpError(403, "Not allowed");
  let bytes: Buffer;
  try { bytes = await readFileBytes(f.storageKey); } catch { throw new HttpError(404, "File missing"); }
  if (sensitive) await logAudit(a.email, "document.read", "file", f.id, { kind: f.kind, ownerEmployeeId: f.ownerEmployeeId, own: owner });
  const safeName = f.originalName.replace(/[^\w.\- ]/g, "_").slice(0, 120) || "file";
  res.setHeader("Content-Type", f.mime);
  res.setHeader("Content-Length", String(bytes.length));
  res.setHeader("Content-Disposition", `inline; filename="${safeName}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.end(bytes);
}));

// =====================================================================
// Assets
// =====================================================================
const accessory = z.union([z.string().trim().min(1).max(120), z.object({ name: z.string().trim().min(1).max(120), qty: z.number().int().min(1).max(100).optional(), note: z.string().max(200).optional() })]);
const assetBody = z.object({
  tag: z.string().trim().min(1).max(60), category: z.string().trim().min(1).max(60), model: nullable(z.string().trim().max(160)),
  serialNo: nullable(z.string().trim().max(120)), costPaise: nullable(z.number().int().min(0).max(10_000_000_000)),
  purchasedOn: nullable(isoDate), condition: z.enum(["new", "good", "fair", "poor"]).optional(), accessories: nullable(z.array(accessory).max(40)),
  status: z.enum(["in_stock", "repair", "retired"]).optional(),
});

r.get("/assets", wrap(async (req, res) => {
  need(req, "people.write");
  const open = await db.select().from(S.assetAssignments).where(isNull(S.assetAssignments.returnedOn));
  const emps = await db.select({ id: S.employees.id, name: S.employees.fullName, code: S.employees.code }).from(S.employees);
  const em = new Map(emps.map((e) => [e.id, e]));
  const holder = new Map(open.map((o) => [o.assetId, o]));
  const rows = await db.select().from(S.assets).orderBy(asc(S.assets.tag));
  res.json(rows.map((x) => {
    const h = holder.get(x.id);
    return { ...x, assignedTo: h ? { employeeId: h.employeeId, name: em.get(h.employeeId)?.name ?? null, code: em.get(h.employeeId)?.code ?? null, issuedOn: h.issuedOn, assignmentId: h.id } : null };
  }));
}));
r.post("/assets", wrap(async (req, res) => {
  need(req, "people.write");
  const b = parse(assetBody, req.body);
  const [row] = await uniq(db.insert(S.assets).values({ ...b, status: b.status ?? "in_stock" }).returning(), "Asset tag already exists");
  await logAudit(actorOf(req).email, "asset.create", "asset", row.id, { tag: row.tag });
  res.status(201).json(row);
}));
r.patch("/assets/:id", wrap(async (req, res) => {
  need(req, "people.write");
  const id = idParam(req);
  const b = parse(assetBody.partial().strict(), req.body);
  if (!Object.keys(b).length) throw new HttpError(400, "Nothing to update");
  const [cur] = await db.select().from(S.assets).where(eq(S.assets.id, id)).limit(1);
  if (!cur) throw new HttpError(404, "Not found");
  if (b.status && cur.status === "assigned") throw new HttpError(409, "Return the asset before changing its status");
  const [row] = await uniq(db.update(S.assets).set(b).where(eq(S.assets.id, id)).returning(), "Asset tag already exists");
  await logAudit(actorOf(req).email, "asset.update", "asset", id, { fields: Object.keys(b) });
  res.json(row);
}));
r.delete("/assets/:id", wrap(async (req, res) => {
  need(req, "people.write");
  const id = idParam(req);
  const [cur] = await db.select().from(S.assets).where(eq(S.assets.id, id)).limit(1);
  if (!cur) throw new HttpError(404, "Not found");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(S.assetAssignments).where(eq(S.assetAssignments.assetId, id));
  if (n > 0 || cur.status === "assigned") {
    // keep the history: retire instead of deleting
    if (cur.status === "assigned") throw new HttpError(409, "Return the asset first");
    await db.update(S.assets).set({ status: "retired" }).where(eq(S.assets.id, id));
    await logAudit(actorOf(req).email, "asset.retire", "asset", id, { tag: cur.tag });
    return res.json({ ok: true, retired: true });
  }
  await db.delete(S.assets).where(eq(S.assets.id, id));
  await logAudit(actorOf(req).email, "asset.delete", "asset", id, { tag: cur.tag });
  res.json({ ok: true, retired: false });
}));
r.post("/assets/:id/assign", wrap(async (req, res) => {
  need(req, "people.write");
  const id = idParam(req);
  const b = parse(z.object({ employeeId: uuid, issuedOn: isoDate, conditionOnIssue: z.enum(["new", "good", "fair", "poor"]).optional() }).strict(), req.body);
  const [emp] = await db.select({ id: S.employees.id, status: S.employees.status }).from(S.employees).where(eq(S.employees.id, b.employeeId)).limit(1);
  if (!emp || emp.status === "exited") throw new HttpError(400, "Unknown or exited employee");
  const row = await db.transaction(async (tx) => {
    const upd = await tx.update(S.assets).set({ status: "assigned" }).where(and(eq(S.assets.id, id), eq(S.assets.status, "in_stock"))).returning();
    if (!upd.length) return null;
    const [asg] = await tx.insert(S.assetAssignments).values({ assetId: id, employeeId: b.employeeId, issuedOn: b.issuedOn, conditionOnIssue: b.conditionOnIssue ?? upd[0].condition }).returning();
    return asg;
  });
  if (!row) throw new HttpError(409, "Asset not found or not in stock");
  await logAudit(actorOf(req).email, "asset.assign", "asset", id, { employeeId: b.employeeId, issuedOn: b.issuedOn });
  res.status(201).json(row);
}));
r.post("/assets/:id/return", wrap(async (req, res) => {
  need(req, "people.write");
  const id = idParam(req);
  const b = parse(z.object({ returnedOn: isoDate, conditionOnReturn: z.enum(["new", "good", "fair", "poor"]).optional(), status: z.enum(["in_stock", "repair", "retired"]).optional() }).strict(), req.body);
  const row = await db.transaction(async (tx) => {
    const [open] = await tx.select().from(S.assetAssignments).where(and(eq(S.assetAssignments.assetId, id), isNull(S.assetAssignments.returnedOn))).limit(1);
    if (!open) return null;
    const [done] = await tx.update(S.assetAssignments).set({ returnedOn: b.returnedOn, conditionOnReturn: b.conditionOnReturn ?? null }).where(eq(S.assetAssignments.id, open.id)).returning();
    await tx.update(S.assets).set({ status: b.status ?? "in_stock", ...(b.conditionOnReturn ? { condition: b.conditionOnReturn } : {}) }).where(eq(S.assets.id, id));
    return done;
  });
  if (!row) throw new HttpError(409, "Asset is not currently assigned");
  await logAudit(actorOf(req).email, "asset.return", "asset", id, { employeeId: row.employeeId, returnedOn: b.returnedOn });
  res.json(row);
}));
async function assetsFor(employeeId: string) {
  const rows = await db.select({ a: S.assets, g: S.assetAssignments }).from(S.assetAssignments)
    .innerJoin(S.assets, eq(S.assets.id, S.assetAssignments.assetId)).where(eq(S.assetAssignments.employeeId, employeeId)).orderBy(desc(S.assetAssignments.issuedOn));
  return rows.map(({ a, g }) => ({
    assignmentId: g.id, issuedOn: g.issuedOn, returnedOn: g.returnedOn, conditionOnIssue: g.conditionOnIssue, conditionOnReturn: g.conditionOnReturn, contractLetterId: g.contractLetterId,
    asset: { id: a.id, tag: a.tag, category: a.category, model: a.model, serialNo: a.serialNo, costPaise: a.costPaise, purchasedOn: a.purchasedOn, condition: a.condition, accessories: a.accessories },
    current: !g.returnedOn,
  }));
}
r.get("/me/assets", wrap(async (req, res) => { res.json(await assetsFor(needEmployee(req))); }));
r.get("/employees/:id/assets", wrap(async (req, res) => {
  const id = idParam(req);
  if (!(actorOf(req).employeeId === id || scope(req, "people.write") === "all")) throw new HttpError(403, "Not allowed");
  res.json(await assetsFor(id));
}));

// =====================================================================
// Policies
// =====================================================================
const slugField = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,78}$/, "slug: lowercase letters, digits, hyphens");

r.get("/policies", wrap(async (req, res) => {
  const empId = actorOf(req).employeeId;
  // Only published policies are listed; a policy still in its first draft has current_version 0.
  const pols = (await db.select().from(S.policies).orderBy(asc(S.policies.title))).filter((p) => p.currentVersion > 0);
  const acks = empId ? await db.select().from(S.policyAcks).where(eq(S.policyAcks.employeeId, empId)) : [];
  res.json(pols.map((p) => ({ slug: p.slug, title: p.title, version: p.currentVersion, acknowledged: acks.some((x) => x.policyId === p.id && x.version === p.currentVersion), updatedAt: p.createdAt })));
}));

// registered before /policies/:slug so "acks" is not read as a slug
r.get("/policies/acks/summary", wrap(async (req, res) => {
  need(req, "policies.manage");
  const pols = (await db.select().from(S.policies).orderBy(asc(S.policies.title))).filter((p) => p.currentVersion > 0);
  const emps = await db.select({ id: S.employees.id, name: S.employees.fullName, code: S.employees.code }).from(S.employees).where(ne(S.employees.status, "exited"));
  const acks = await db.select().from(S.policyAcks);
  res.json(pols.map((p) => {
    const done = new Set(acks.filter((x) => x.policyId === p.id && x.version === p.currentVersion).map((x) => x.employeeId));
    const pending = emps.filter((e) => !done.has(e.id));
    return { slug: p.slug, title: p.title, version: p.currentVersion, total: emps.length, acknowledged: emps.length - pending.length, pending: pending.map((e) => ({ id: e.id, name: e.name, code: e.code })) };
  }));
}));

r.get("/policies/:slug", wrap(async (req, res) => {
  const slug = parse(slugField, req.params.slug);
  const [p] = await db.select().from(S.policies).where(eq(S.policies.slug, slug)).limit(1);
  if (!p || p.currentVersion < 1) throw new HttpError(404, "Not found");
  const [v] = await db.select().from(S.policyVersions).where(and(eq(S.policyVersions.policyId, p.id), eq(S.policyVersions.version, p.currentVersion))).limit(1);
  const empId = actorOf(req).employeeId;
  const [ack] = empId ? await db.select().from(S.policyAcks).where(and(eq(S.policyAcks.policyId, p.id), eq(S.policyAcks.version, p.currentVersion), eq(S.policyAcks.employeeId, empId))).limit(1) : [];
    // Filled in with today's Configuration values (committee, contacts, company), so updates show without re-publishing.
  const live = v && !v.fileId ? renderLive(v, await placeholderValues()) : null;
  res.json({ slug: p.slug, title: p.title, version: p.currentVersion, html: live ? live.html : v ? sanitizeHtml(v.html) : "", publishedAt: v?.publishedAt ?? v?.createdAt ?? null, acknowledged: !!ack, acknowledgedAt: ack?.at ?? null,
    kind: p.kind, fileUrl: v?.fileId ? `/api/policies/${p.slug}/file` : null });
}));

/** The PDF of the published version, for any staff member (PDF policies are view and acknowledge only). */
r.get("/policies/:slug/file", wrap(async (req, res) => {
  const slug = parse(slugField, req.params.slug);
  const [p] = await db.select().from(S.policies).where(eq(S.policies.slug, slug)).limit(1);
  if (!p || p.currentVersion < 1) throw new HttpError(404, "Not found");
  const [v] = await db.select().from(S.policyVersions).where(and(eq(S.policyVersions.policyId, p.id), eq(S.policyVersions.version, p.currentVersion))).limit(1);
  if (!v?.fileId) throw new HttpError(404, "This policy has no file");
  const [f] = await db.select().from(S.files).where(eq(S.files.id, v.fileId)).limit(1);
  if (!f) throw new HttpError(404, "Not found");
  res.type("application/pdf").setHeader("Content-Disposition", `inline; filename="${slug}-v${p.currentVersion}.pdf"`);
  res.send(await readFileBytes(f.storageKey));
}));

r.post("/policies", wrap(async (req, res) => {
  need(req, "policies.manage");
  // Direct publishing skips approval, so only the CEO can use it; everyone else drafts in Configuration → Policies.
  if (!actorOf(req).roles.has("super_admin")) throw new HttpError(403, "Policies now need CEO approval. Draft them in Configuration → Policies.");
  const b = parse(z.object({ slug: slugField, title: z.string().trim().min(1).max(200), html: z.string().min(1).max(400_000) }).strict(), req.body);
  const html = sanitizeHtml(b.html);
  const email = actorOf(req).email;
  const out = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(S.policies).where(eq(S.policies.slug, b.slug)).limit(1).for("update");
    let policyId: string; let version: number;
    if (existing) {
      version = existing.currentVersion + 1; policyId = existing.id;
      await tx.update(S.policies).set({ title: b.title, currentVersion: version }).where(eq(S.policies.id, policyId));
    } else {
      version = 1;
      const [np] = await tx.insert(S.policies).values({ slug: b.slug, title: b.title, currentVersion: 1 }).returning();
      policyId = np.id;
    }
    await tx.insert(S.policyVersions).values({ policyId, version, html, publishedBy: email });
    return { policyId, version };
  });
  await logAudit(email, "policy.publish", "policy", out.policyId, { slug: b.slug, version: out.version });
  res.status(201).json({ slug: b.slug, title: b.title, version: out.version });
}));

r.post("/policies/:slug/ack", wrap(async (req, res) => {
  const empId = needEmployee(req);
  const slug = parse(slugField, req.params.slug);
  const [p] = await db.select().from(S.policies).where(eq(S.policies.slug, slug)).limit(1);
  if (!p || p.currentVersion < 1) throw new HttpError(404, "Not found");
  // Record exactly what was shown: the values filled in and a hash of the rendered text.
  const [v] = await db.select().from(S.policyVersions).where(and(eq(S.policyVersions.policyId, p.id), eq(S.policyVersions.version, p.currentVersion))).limit(1);
  const live = v && !v.fileId ? renderLive(v, await placeholderValues()) : null;
  await db.insert(S.policyAcks).values({ policyId: p.id, version: p.currentVersion, employeeId: empId, contentHash: live?.contentHash ?? null, values: live?.snapshot ?? null }).onConflictDoNothing();
  await logAudit(actorOf(req).email, "policy.ack", "policy", p.id, { slug, version: p.currentVersion });
  res.json({ ok: true, slug, version: p.currentVersion });
}));

// =====================================================================
// Announcements and email templates
// =====================================================================
r.get("/announcements", wrap(async (_req, res) => {
  res.json(await db.select().from(S.announcements).orderBy(desc(S.announcements.pinned), desc(S.announcements.createdAt)).limit(50));
}));
r.post("/announcements", wrap(async (req, res) => {
  need(req, "people.write");
  const b = parse(z.object({ title: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(5000), kind: z.enum(["news", "update", "event"]).optional(), pinned: z.boolean().optional() }).strict(), req.body);
  const [row] = await db.insert(S.announcements).values({ ...b, createdBy: actorOf(req).email }).returning();
  await logAudit(actorOf(req).email, "announcement.create", "announcement", row.id, { kind: row.kind });
  res.status(201).json(row);
}));

const tplKey = z.string().trim().regex(/^[a-z0-9_]{2,60}$/, "invalid template key");
r.get("/email-templates", wrap(async (req, res) => {
  need(req, "letters.generate");
  res.json(await db.select().from(S.emailTemplates).orderBy(asc(S.emailTemplates.key)));
}));
r.get("/email-templates/:key", wrap(async (req, res) => {
  need(req, "letters.generate");
  const [t] = await db.select().from(S.emailTemplates).where(eq(S.emailTemplates.key, parse(tplKey, req.params.key))).limit(1);
  if (!t) throw new HttpError(404, "Not found");
  res.json(t);
}));
r.put("/email-templates/:key", wrap(async (req, res) => {
  need(req, "letters.generate");
  const key = parse(tplKey, req.params.key);
  const b = parse(z.object({ subject: z.string().trim().min(1).max(200), body: z.string().min(1).max(20000) }).strict(), req.body);
  const [row] = await db.insert(S.emailTemplates).values({ key, ...b }).onConflictDoUpdate({ target: S.emailTemplates.key, set: { ...b, updatedAt: new Date() } }).returning();
  await logAudit(actorOf(req).email, "email_template.update", "email_template", row.id, { key });
  res.json(row);
}));

// =====================================================================
// Consent
// =====================================================================
const subjectOf = (employeeId: string) => "emp_" + employeeId;
async function latestConsent(subjectId: string) {
  const rows = await db.select().from(S.consentEvents).where(eq(S.consentEvents.subjectId, subjectId)).orderBy(desc(S.consentEvents.at));
  const m = new Map<string, (typeof rows)[number]>();
  for (const e of rows) if (!m.has(e.purposeKey)) m.set(e.purposeKey, e);
  return m;
}
r.get("/me/consents", wrap(async (req, res) => {
  const m = await latestConsent(subjectOf(needEmployee(req)));
  res.json(CONSENT_PURPOSES.map((p) => {
    const e = m.get(p.key);
    return { key: p.key, label: p.label, required: p.required, status: e?.status ?? "not_set", noticeVersion: e?.noticeVersion ?? null, at: e?.at ?? null };
  }));
}));
r.put("/me/consents/:key", wrap(async (req, res) => {
  const empId = needEmployee(req);
  const key = String(req.params.key);
  const purpose = CONSENT_PURPOSES.find((p) => p.key === key);
  if (!purpose) throw new HttpError(404, "Unknown consent purpose");
  const b = parse(z.object({ granted: z.boolean(), noticeVersion: z.string().trim().min(1).max(40) }).strict(), req.body);
  if (!b.granted && purpose.required) throw new HttpError(400, "This purpose is required and cannot be withdrawn");
  const status = b.granted ? "granted" : "withdrawn";
  const subjectId = subjectOf(empId);
  const [row] = await db.insert(S.consentEvents).values({ subjectId, purposeKey: key, status, noticeVersion: b.noticeVersion, source: "hr_app" }).returning();
  sendConsentEvent({ subjectId, purposeKey: key, status, noticeVersion: b.noticeVersion });
  if (key === LOGIN_PURPOSE) await onLoginConsent(empId, b.granted);
  res.json({ key, status, noticeVersion: row.noticeVersion, at: row.at });
}));

// =====================================================================
// Home feed
// =====================================================================
r.get("/home", wrap(async (req, res) => {
  const a = actorOf(req);
  const today = istToday();
  const emps = await db.select({ id: S.employees.id, name: S.employees.fullName, dob: S.employees.dob, joiningDate: S.employees.joiningDate, photoFileId: S.employees.photoFileId })
    .from(S.employees).where(ne(S.employees.status, "exited"));
  const optRows = await db.select().from(S.consentEvents).where(eq(S.consentEvents.purposeKey, "show_birthday")).orderBy(desc(S.consentEvents.at));
  const latest = new Map<string, string>();
  for (const e of optRows) if (!latest.has(e.subjectId)) latest.set(e.subjectId, e.status);
  const photo = new Map(emps.map((e) => [e.id, e.photoFileId]));
  const events = upcomingEvents(today, emps.map((e) => ({ id: e.id, name: e.name, dob: e.dob, joiningDate: e.joiningDate, birthdayOptIn: latest.get(subjectOf(e.id)) === "granted" })), 30)
    .map((ev) => ({ ...ev, photoFileId: photo.get(ev.id) ?? null }));
  const announcements = await db.select().from(S.announcements).orderBy(desc(S.announcements.pinned), desc(S.announcements.createdAt)).limit(5);
  let policiesToAck = 0;
  if (a.employeeId) {
    const pols = await db.select().from(S.policies);
    const acks = await db.select().from(S.policyAcks).where(eq(S.policyAcks.employeeId, a.employeeId));
    policiesToAck = pols.filter((p) => p.currentVersion > 0 && !acks.some((x) => x.policyId === p.id && x.version === p.currentVersion)).length; // 0 = still in its first draft
  }
  res.json({
    today,
    birthdays: events.filter((e) => e.kind === "birthday"),
    anniversaries: events.filter((e) => e.kind === "anniversary"),
    announcements,
    pending: { policiesToAck },
  });
}));

// =====================================================================
// Audit
// =====================================================================
r.get("/audit", wrap(async (req, res) => {
  need(req, "audit.read");
  const q = parse(z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(), offset: z.coerce.number().int().min(0).optional(),
    actor: z.string().max(200).optional(), action: z.string().max(100).optional(), entityType: z.string().max(100).optional(), entityId: z.string().max(100).optional(),
  }), req.query);
  const where = and(
    q.actor ? eq(S.auditLog.actorEmail, q.actor.toLowerCase()) : undefined, q.action ? eq(S.auditLog.action, q.action) : undefined,
    q.entityType ? eq(S.auditLog.entityType, q.entityType) : undefined, q.entityId ? eq(S.auditLog.entityId, q.entityId) : undefined,
  );
  const limit = q.limit ?? 50, offset = q.offset ?? 0;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(S.auditLog).where(where);
  const items = await db.select().from(S.auditLog).where(where).orderBy(desc(S.auditLog.at)).limit(limit).offset(offset);
  res.json({ items, total: n, limit, offset });
}));

// =====================================================================
// Elevated role assignment
// =====================================================================
const ASSIGNABLE = ["super_admin", "hr_admin", "finance_signatory"] as const satisfies readonly Role[];
const isSuperAdmin = (req: Request) => actorOf(req).roles.has("super_admin");
r.get("/user-roles", wrap(async (req, res) => {
  need(req, "people.write");
  res.json(await db.select().from(S.userRoles).orderBy(asc(S.userRoles.email), asc(S.userRoles.role)));
}));
r.post("/user-roles", wrap(async (req, res) => {
  need(req, "people.write");
  const b = parse(z.object({ email: domainEmail, role: z.enum(ASSIGNABLE) }).strict(), req.body);
  if (b.role === "super_admin" && !isSuperAdmin(req)) throw new HttpError(403, "Only a super admin can grant super admin");
  const [row] = await db.insert(S.userRoles).values(b).onConflictDoNothing().returning();
  if (!row) return res.status(200).json({ ok: true, existing: true });
  await logAudit(actorOf(req).email, "user_role.grant", "user_role", row.id, { email: b.email, role: b.role });
  res.status(201).json(row);
}));
r.delete("/user-roles/:id", wrap(async (req, res) => {
  need(req, "people.write");
  const id = idParam(req);
  const superAdmin = isSuperAdmin(req);
  const out = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(S.userRoles).where(eq(S.userRoles.id, id)).limit(1).for("update");
    if (!row) return "missing" as const;
    if (row.role === "super_admin" && !superAdmin) return "forbidden" as const;
    if (row.role === "hr_admin" || row.role === "super_admin") {
      // Keep at least one person who can manage people: a super admin or an hr_admin.
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(S.userRoles).where(inArray(S.userRoles.role, ["hr_admin", "super_admin"]));
      if (n <= 1) return "last" as const;
    }
    await tx.delete(S.userRoles).where(eq(S.userRoles.id, id));
    return row;
  });
  if (out === "missing") throw new HttpError(404, "Not found");
  if (out === "forbidden") throw new HttpError(403, "Only a super admin can remove super admin");
  if (out === "last") throw new HttpError(409, "Cannot remove the last hr_admin or super_admin");
  await logAudit(actorOf(req).email, "user_role.revoke", "user_role", id, { email: out.email, role: out.role });
  res.json({ ok: true });
}));

export default r;
