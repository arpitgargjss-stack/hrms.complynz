import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { env } from "../env";
import { wrap, parse, HttpError } from "./util";
import { logAudit } from "../lib/audit";
import { encryptField, decryptField, hmac, maskTail, newToken } from "../lib/crypto";
import { sendEmail, fillTemplate } from "../lib/email";
import { renderLetter, LETTER_TYPES } from "../lib/letterHtml";
import { need, requireHr, idParam, dateStr } from "../lib/routeHelpers";
import { letterRef, nextEmployeeCode } from "../../shared/hr/misc";
import { canAccess } from "../../shared/hr/access";

const r = Router();
const A = schema;

// ---------- candidates ----------
const candidateBody = z.object({
  fullName: z.string().trim().min(2).max(120), email: z.string().trim().toLowerCase().email().max(200),
  phone: z.string().trim().max(20).optional(), position: z.string().trim().max(120).optional(),
  departmentId: z.string().uuid().optional(), expectedJoining: dateStr.optional(),
  status: z.enum(["new", "offered", "accepted", "joined", "declined"]).optional(),
});

r.get("/candidates", wrap(async (req, res) => {
  need(req, "hiring.manage", "all");
  res.json(await db.select().from(A.candidates).orderBy(desc(A.candidates.createdAt)));
}));
r.post("/candidates", wrap(async (req, res) => {
  need(req, "hiring.manage", "all");
  const b = parse(candidateBody, req.body);
  const [row] = await db.insert(A.candidates).values({ ...b, createdBy: req.actor!.email }).returning();
  await logAudit(req.actor!.email, "candidate.create", "candidate", row.id);
  res.status(201).json(row);
}));
r.get("/candidates/:id", wrap(async (req, res) => {
  need(req, "hiring.manage", "all");
  const [row] = await db.select().from(A.candidates).where(eq(A.candidates.id, idParam(req))).limit(1);
  if (!row) throw new HttpError(404, "Not found");
  const letters = await db.select({ id: A.letters.id, type: A.letters.type, refNo: A.letters.refNo, status: A.letters.status }).from(A.letters).where(eq(A.letters.candidateId, row.id));
  res.json({ ...row, letters });
}));
r.patch("/candidates/:id", wrap(async (req, res) => {
  need(req, "hiring.manage", "all");
  const b = parse(candidateBody.partial(), req.body);
  const [row] = await db.update(A.candidates).set(b).where(eq(A.candidates.id, idParam(req))).returning();
  if (!row) throw new HttpError(404, "Not found");
  await logAudit(req.actor!.email, "candidate.update", "candidate", row.id, { fields: Object.keys(b) });
  res.json(row);
}));
r.delete("/candidates/:id", wrap(async (req, res) => {
  need(req, "hiring.manage", "all");
  const id = idParam(req);
  const [l] = await db.select({ id: A.letters.id }).from(A.letters).where(eq(A.letters.candidateId, id)).limit(1);
  if (l) throw new HttpError(409, "Candidate has letters; mark as declined instead");
  await db.delete(A.onboardingLinks).where(eq(A.onboardingLinks.candidateId, id));
  await db.delete(A.candidates).where(eq(A.candidates.id, id));
  await logAudit(req.actor!.email, "candidate.delete", "candidate", id);
  res.json({ ok: true });
}));

// ---------- letters ----------
const letterBody = z.object({
  type: z.enum(LETTER_TYPES), candidateId: z.string().uuid().optional(), employeeId: z.string().uuid().optional(),
  payload: z.record(z.unknown()).refine((p) => JSON.stringify(p).length < 20000, "Payload too large").default({}),
}).refine((b) => !!b.candidateId !== !!b.employeeId, "Provide exactly one of candidateId or employeeId");

r.get("/letters", wrap(async (req, res) => {
  const q = z.object({ candidateId: z.string().uuid().optional(), employeeId: z.string().uuid().optional(), type: z.enum(LETTER_TYPES).optional(), status: z.string().max(20).optional() }).parse(req.query);
  const scope = need(req, "letters.generate");
  const conds = [];
  if (q.candidateId) conds.push(eq(A.letters.candidateId, q.candidateId));
  if (q.employeeId) conds.push(eq(A.letters.employeeId, q.employeeId));
  if (q.type) conds.push(eq(A.letters.type, q.type));
  if (q.status) conds.push(eq(A.letters.status, q.status));
  const rows = await db.select().from(A.letters).where(conds.length ? and(...conds) : undefined).orderBy(desc(A.letters.createdAt)).limit(500);
  void scope;
  res.json(rows);
}));
// Non-HR staff: own issued letters only.
r.get("/me/letters", wrap(async (req, res) => {
  const me = req.actor!.employeeId;
  if (!me) return res.json([]);
  const rows = await db.select({ id: A.letters.id, type: A.letters.type, refNo: A.letters.refNo, status: A.letters.status, issuedAt: A.letters.issuedAt })
    .from(A.letters).where(and(eq(A.letters.employeeId, me), inArray(A.letters.status, ["issued", "accepted"]))).orderBy(desc(A.letters.createdAt));
  res.json(rows);
}));

r.post("/letters", wrap(async (req, res) => {
  need(req, "letters.generate", "all");
  const b = parse(letterBody, req.body);
  if (b.candidateId) { const [c] = await db.select({ id: A.candidates.id }).from(A.candidates).where(eq(A.candidates.id, b.candidateId)).limit(1); if (!c) throw new HttpError(404, "Candidate not found"); }
  if (b.employeeId) { const [e] = await db.select({ id: A.employees.id }).from(A.employees).where(eq(A.employees.id, b.employeeId)).limit(1); if (!e) throw new HttpError(404, "Employee not found"); }
  const year = new Date().getUTCFullYear();
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7101)`);
    const res2 = await tx.execute(sql`select coalesce(max(cast(split_part(ref_no, '/', 4) as integer)), 0) as m from hr_letters where ref_no like ${`CMPZ/HR/${year}/%`}`);
    const max = Number((res2.rows[0] as { m: number | string } | undefined)?.m ?? 0);
    const [ins] = await tx.insert(A.letters).values({ type: b.type, refNo: letterRef(year, max + 1), candidateId: b.candidateId, employeeId: b.employeeId, payload: b.payload }).returning();
    return ins;
  });
  await logAudit(req.actor!.email, "letter.create", "letter", row.id, { type: row.type, refNo: row.refNo });
  res.status(201).json(row);
}));

r.patch("/letters/:id", wrap(async (req, res) => {
  need(req, "letters.generate", "all");
  const b = parse(z.object({ payload: z.record(z.unknown()).refine((p) => JSON.stringify(p).length < 20000) }), req.body);
  const [row] = await db.update(A.letters).set({ payload: b.payload }).where(and(eq(A.letters.id, idParam(req)), eq(A.letters.status, "draft"))).returning();
  if (!row) throw new HttpError(409, "Only draft letters can be edited");
  await logAudit(req.actor!.email, "letter.update", "letter", row.id);
  res.json(row);
}));

r.post("/letters/:id/issue", wrap(async (req, res) => {
  need(req, "letters.generate", "all");
  const [row] = await db.update(A.letters).set({ status: "issued", issuedBy: req.actor!.email, issuedAt: new Date() })
    .where(and(eq(A.letters.id, idParam(req)), eq(A.letters.status, "draft"))).returning();
  if (!row) throw new HttpError(409, "Letter not found or already issued");
  if (row.candidateId && (row.type === "offer_short" || row.type === "offer_full")) {
    await db.update(A.candidates).set({ status: "offered" }).where(and(eq(A.candidates.id, row.candidateId), eq(A.candidates.status, "new")));
  }
  await logAudit(req.actor!.email, "letter.issue", "letter", row.id, { type: row.type, refNo: row.refNo });
  res.json(row);
}));

async function recipientName(l: typeof A.letters.$inferSelect): Promise<{ name: string; email: string | null }> {
  if (l.candidateId) { const [c] = await db.select().from(A.candidates).where(eq(A.candidates.id, l.candidateId)).limit(1); return { name: c?.fullName ?? "", email: c?.email ?? null }; }
  if (l.employeeId) { const [e] = await db.select().from(A.employees).where(eq(A.employees.id, l.employeeId)).limit(1); return { name: e?.fullName ?? "", email: e?.personalEmail ?? e?.workEmail ?? null }; }
  return { name: "", email: null };
}

r.get("/letters/:id/html", wrap(async (req, res) => {
  const id = idParam(req);
  const [l] = await db.select().from(A.letters).where(eq(A.letters.id, id)).limit(1);
  if (!l) throw new HttpError(404, "Not found");
  const scope = need(req, "letters.generate");
  const hr = scope === "all";
  if (!hr) {
    // Staff can read only their own issued letters.
    if (!l.employeeId || !canAccess("own", req.actor!, l.employeeId) || l.status === "draft") throw new HttpError(404, "Not found");
  }
  const who = await recipientName(l);
  const html = renderLetter({ type: l.type, refNo: l.refNo, name: who.name, issuedAt: l.issuedAt, status: l.status, payload: (l.payload ?? {}) as Record<string, unknown> });
  res.type("html").send(html);
}));

// ---------- acceptance link ----------
const DEFAULT_OFFER_TEMPLATE = {
  subject: "Your offer from Complynz",
  body: "Hello {{name}},\n\nYour offer documents from Complynz are ready. Please open the secure link below, verify with a one-time code sent to this email address, and review and accept.\n\n{{link}}\n\nThis link expires on {{expiry}}. If you did not expect this email, you can ignore it.\n\nComplynz HR",
};

r.post("/letters/:id/share", wrap(async (req, res) => {
  need(req, "letters.generate", "all");
  const b = parse(z.object({ recipientEmail: z.string().trim().toLowerCase().email().max(200).optional() }), req.body ?? {});
  const [l] = await db.select().from(A.letters).where(eq(A.letters.id, idParam(req))).limit(1);
  if (!l) throw new HttpError(404, "Not found");
  if (l.status !== "issued") throw new HttpError(409, "Issue the letter before sharing");
  const who = await recipientName(l);
  const email = b.recipientEmail ?? who.email;
  if (!email) throw new HttpError(400, "No recipient email available");
  const { token, hash } = newToken();
  const expiresAt = new Date(Date.now() + 7 * 86400_000);
  await db.insert(A.acceptanceLinks).values({ letterId: l.id, tokenHash: hash, recipientEmailHash: hmac(email, "recipient"), recipientEmail: email, expiresAt });
  const linkPath = `/accept/${token}`;
  const [tpl] = await db.select().from(A.emailTemplates).where(eq(A.emailTemplates.key, "offer_link")).limit(1);
  const t = tpl ?? DEFAULT_OFFER_TEMPLATE;
  const vars = { name: who.name || "there", link: env.HR_APP_URL.replace(/\/$/, "") + linkPath, expiry: expiresAt.toISOString().slice(0, 10) };
  const sent = await sendEmail({ to: email, subject: fillTemplate(t.subject, vars), text: fillTemplate(t.body, vars) });
  await logAudit(req.actor!.email, "letter.share", "letter", l.id, { expiresAt, emailed: sent });
  res.status(201).json({ linkPath, expiresAt, emailed: sent }); // the only time the link path is returned
}));

// ---------- onboarding ----------
const STEP_RE = /^[a-z_]{2,30}$/;
r.post("/candidates/:id/onboarding-link", wrap(async (req, res) => {
  need(req, "hiring.manage", "all");
  const b = parse(z.object({ steps: z.array(z.string().regex(STEP_RE)).min(1).max(12) }), req.body);
  const [c] = await db.select().from(A.candidates).where(eq(A.candidates.id, idParam(req))).limit(1);
  if (!c) throw new HttpError(404, "Not found");
  const { token, hash } = newToken();
  const expiresAt = new Date(Date.now() + 14 * 86400_000);
  const [link] = await db.insert(A.onboardingLinks).values({ candidateId: c.id, tokenHash: hash, steps: [...new Set(b.steps)], expiresAt }).returning({ id: A.onboardingLinks.id });
  const linkPath = `/onboarding/${token}`;
  const vars = { name: c.fullName, link: env.HR_APP_URL.replace(/\/$/, "") + linkPath, expiry: expiresAt.toISOString().slice(0, 10) };
  const [tpl] = await db.select().from(A.emailTemplates).where(eq(A.emailTemplates.key, "onboarding_link")).limit(1);
  const t = tpl ?? { subject: "Complete your joining details at Complynz", body: "Hello {{name}},\n\nPlease complete your joining details using the secure link below. You will verify with a one-time code sent to this email address.\n\n{{link}}\n\nThis link expires on {{expiry}}.\n\nComplynz HR" };
  const sent = await sendEmail({ to: c.email, subject: fillTemplate(t.subject, vars), text: fillTemplate(t.body, vars) });
  await logAudit(req.actor!.email, "onboarding.link", "candidate", c.id, { linkId: link.id, emailed: sent });
  res.status(201).json({ linkPath, expiresAt, emailed: sent });
}));

type Submission = { personal?: Record<string, unknown>; panEnc?: string; accountEnc?: string; bankName?: string; ifsc?: string; documents?: { fileId: string; kind: string; name: string }[]; submittedAt?: string };
const safeMask = (enc?: string) => { if (!enc) return null; try { return maskTail(decryptField(enc)); } catch { return null; } };

r.get("/candidates/:id/onboarding", wrap(async (req, res) => {
  need(req, "hiring.manage", "all");
  const id = idParam(req);
  const links = await db.select().from(A.onboardingLinks).where(eq(A.onboardingLinks.candidateId, id)).orderBy(desc(A.onboardingLinks.createdAt));
  await logAudit(req.actor!.email, "onboarding.view", "candidate", id);
  res.json(links.map((l) => {
    const s = (l.submitted ?? null) as Submission | null;
    return {
      id: l.id, steps: l.steps, expiresAt: l.expiresAt, completedAt: l.completedAt, createdAt: l.createdAt,
      submission: s ? { personal: s.personal ?? null, panMasked: safeMask(s.panEnc), accountMasked: safeMask(s.accountEnc), bankName: s.bankName ?? null, ifsc: s.ifsc ?? null, documents: s.documents ?? [], submittedAt: s.submittedAt ?? null } : null,
    };
  }));
}));

r.post("/candidates/:id/convert", wrap(async (req, res) => {
  requireHr(req);
  need(req, "people.write", "all");
  const b = parse(z.object({
    workEmail: z.string().trim().toLowerCase().email().max(200), joiningDate: dateStr.optional(),
    departmentId: z.string().uuid().optional(), designationId: z.string().uuid().optional(), locationId: z.string().uuid().optional(),
    managerId: z.string().uuid().optional(), employmentType: z.enum(["full_time", "part_time", "contract", "intern"]).optional(),
  }), req.body);
  if (!b.workEmail.endsWith("@" + env.STAFF_EMAIL_DOMAIN)) throw new HttpError(400, `Work email must be @${env.STAFF_EMAIL_DOMAIN}`);
  const id = idParam(req);
  const [c] = await db.select().from(A.candidates).where(eq(A.candidates.id, id)).limit(1);
  if (!c) throw new HttpError(404, "Not found");
  if (c.status === "joined") throw new HttpError(409, "Already converted");
  const [link] = await db.select().from(A.onboardingLinks).where(and(eq(A.onboardingLinks.candidateId, id), sql`${A.onboardingLinks.completedAt} is not null`)).orderBy(desc(A.onboardingLinks.completedAt)).limit(1);
  if (!link) throw new HttpError(409, "The candidate has not completed onboarding");
  const s = (link.submitted ?? {}) as Submission;
  const personal = (s.personal ?? {}) as Record<string, string | undefined>;
  const joiningDate = b.joiningDate ?? c.expectedJoining;
  if (!joiningDate) throw new HttpError(400, "joiningDate is required");
  const emp = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7102)`);
    const codes = (await tx.select({ code: A.employees.code }).from(A.employees)).map((x) => x.code);
    const [e] = await tx.insert(A.employees).values({
      code: nextEmployeeCode(codes), workEmail: b.workEmail, fullName: personal.fullName?.trim() || c.fullName, personalEmail: c.email, phone: personal.phone ?? c.phone ?? null,
      dob: personal.dob ?? null, gender: personal.gender ?? null, joiningDate,
      departmentId: b.departmentId ?? c.departmentId ?? null, designationId: b.designationId ?? null, locationId: b.locationId ?? null, managerId: b.managerId ?? null,
      employmentType: b.employmentType ?? "full_time", status: "active",
      panEnc: s.panEnc ?? null, bankName: s.bankName ?? null, accountEnc: s.accountEnc ?? null, ifsc: s.ifsc ?? null,
    }).returning();
    const fileIds = (s.documents ?? []).map((d) => d.fileId);
    if (fileIds.length) await tx.update(A.files).set({ ownerEmployeeId: e.id }).where(inArray(A.files.id, fileIds));
    await tx.update(A.candidates).set({ status: "joined" }).where(eq(A.candidates.id, id));
    await tx.update(A.letters).set({ employeeId: e.id }).where(eq(A.letters.candidateId, id));
    return e;
  });
  await logAudit(req.actor!.email, "candidate.convert", "employee", emp.id, { candidateId: id, code: emp.code });
  res.status(201).json({ id: emp.id, code: emp.code });
}));

export default r;
