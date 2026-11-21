import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { env } from "../env";
import { wrap, parse, HttpError } from "./util";
import { logAudit } from "../lib/audit";
import { encryptField, decryptField, hmac, maskTail, newToken } from "../lib/crypto";
import { sendEmail, fillTemplate } from "../lib/email";
import { renderLetter } from "../lib/letterHtml";
import { LETTER_TYPES, COMPANY_DEFAULTS, type CompanyProfile } from "../../shared/hr/letters";
import { letterContext } from "../lib/letterContext";
import { carryOfferConsents, offerConsentRecord } from "../lib/offerConsents";
import { CONSENT_PURPOSES } from "../../shared/hr/misc";
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

/** The data choices a candidate made on the offer acceptance page, for HR to see. Null until they accept online. */
r.get("/candidates/:id/consents", wrap(async (req, res) => {
  requireHr(req);
  const rec = await offerConsentRecord(idParam(req));
  res.json(rec ? CONSENT_PURPOSES.map((c) => ({ key: c.key, title: c.title, granted: rec[c.key]?.granted ?? null, at: rec[c.key]?.at ?? null })) : null);
}));
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
  const cands = new Map((await db.select({ id: A.candidates.id, n: A.candidates.fullName }).from(A.candidates)).map((c) => [c.id, c.n]));
  const emps = new Map((await db.select({ id: A.employees.id, n: A.employees.fullName, code: A.employees.code }).from(A.employees)).map((e) => [e.id, e]));
  res.json(rows.map((l) => ({ ...l, recipient: l.employeeId ? emps.get(l.employeeId)?.n ?? "" : l.candidateId ? cands.get(l.candidateId) ?? "" : "", recipientCode: l.employeeId ? emps.get(l.employeeId)?.code ?? null : null, recipientKind: l.employeeId ? "employee" : "candidate" })));
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
    const [ins] = await tx.insert(A.letters).values({ type: b.type, refNo: letterRef(year, max + 1), candidateId: b.candidateId, employeeId: b.employeeId, payload: b.payload, createdBy: req.actor!.email }).returning();
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

/** HR sends a draft to the CEO. A super admin's own draft can be approved straight away from the approvals list. */
r.post("/letters/:id/submit", wrap(async (req, res) => {
  need(req, "letters.generate", "all");
  const [row] = await db.update(A.letters).set({ status: "pending_approval", submittedBy: req.actor!.email, submittedAt: new Date(), reviewNote: null })
    .where(and(eq(A.letters.id, idParam(req)), eq(A.letters.status, "draft"))).returning();
  if (!row) throw new HttpError(409, "Only a draft can be sent for approval");
  await logAudit(req.actor!.email, "letter.submit", "letter", row.id, { type: row.type, refNo: row.refNo });
  res.json(row);
}));
function requireCeo(req: Parameters<typeof need>[0]) { if (!req.actor?.roles.has("super_admin")) throw new HttpError(403, "Only the CEO (super admin) can approve letters"); }
r.post("/letters/:id/approve", wrap(async (req, res) => {
  requireCeo(req);
  const [row] = await db.update(A.letters).set({ status: "approved", approvedBy: req.actor!.email, approvedAt: new Date() })
    .where(and(eq(A.letters.id, idParam(req)), inArray(A.letters.status, ["pending_approval", "draft"]))).returning();
  if (!row) throw new HttpError(409, "Letter not found or not waiting for approval");
  await logAudit(req.actor!.email, "letter.approve", "letter", row.id, { type: row.type, refNo: row.refNo });
  res.json(row);
}));
r.post("/letters/:id/reject", wrap(async (req, res) => {
  requireCeo(req);
  const b = parse(z.object({ note: z.string().trim().min(2).max(1000) }), req.body);
  const [row] = await db.update(A.letters).set({ status: "draft", reviewNote: b.note, approvedBy: null, approvedAt: null })
    .where(and(eq(A.letters.id, idParam(req)), eq(A.letters.status, "pending_approval"))).returning();
  if (!row) throw new HttpError(409, "Letter not found or not waiting for approval");
  await logAudit(req.actor!.email, "letter.reject", "letter", row.id);
  res.json(row);
}));

r.post("/letters/:id/issue", wrap(async (req, res) => {
  need(req, "letters.generate", "all");
  const [row] = await db.update(A.letters).set({ status: "issued", issuedBy: req.actor!.email, issuedAt: new Date() })
    .where(and(eq(A.letters.id, idParam(req)), eq(A.letters.status, "approved"))).returning();
  if (!row) throw new HttpError(409, "A letter can be issued only after the CEO approves it");
  if (row.candidateId && (row.type === "offer_short" || row.type === "offer_full")) {
    await db.update(A.candidates).set({ status: "offered" }).where(and(eq(A.candidates.id, row.candidateId), eq(A.candidates.status, "new")));
  }
  await logAudit(req.actor!.email, "letter.issue", "letter", row.id, { type: row.type, refNo: row.refNo });
  res.json(row);
}));
r.post("/letters/:id/void", wrap(async (req, res) => {
  need(req, "letters.generate", "all");
  const [row] = await db.update(A.letters).set({ status: "void" }).where(and(eq(A.letters.id, idParam(req)), inArray(A.letters.status, ["draft", "pending_approval", "approved", "issued"]))).returning();
  if (!row) throw new HttpError(409, "This letter cannot be withdrawn");
  await logAudit(req.actor!.email, "letter.void", "letter", row.id);
  res.json(row);
}));

// ---------- company details printed on letters ----------
const profileSchema = z.object(Object.fromEntries(Object.keys(COMPANY_DEFAULTS).map((k) => [k, z.string().trim().max(400)])) as Record<keyof CompanyProfile, z.ZodString>).partial().strict();
r.get("/letters/company", wrap(async (req, res) => {
  need(req, "letters.generate", "all");
  const [row] = await db.select().from(A.companyProfile).orderBy(desc(A.companyProfile.id)).limit(1);
  res.json({ ...COMPANY_DEFAULTS, ...((row?.settings ?? {}) as Partial<CompanyProfile>) });
}));
r.put("/letters/company", wrap(async (req, res) => {
  need(req, "letters.generate", "all");
  if (!req.actor!.roles.has("super_admin")) throw new HttpError(403, "Only the CEO (super admin) can change what is printed on letters");
  const b = parse(profileSchema, req.body);
  await db.insert(A.companyProfile).values({ settings: b, updatedBy: req.actor!.email });
  await logAudit(req.actor!.email, "letters.company.update", "company_profile", undefined, { fields: Object.keys(b) });
  res.json({ ...COMPANY_DEFAULTS, ...b });
}));

/** Values a letter form can start from, for one employee or candidate. */
r.get("/letters/prefill", wrap(async (req, res) => {
  need(req, "letters.generate", "all");
  const q = z.object({ employeeId: z.string().uuid().optional(), candidateId: z.string().uuid().optional() }).parse(req.query);
  if (q.candidateId) {
    const [c] = await db.select().from(A.candidates).where(eq(A.candidates.id, q.candidateId)).limit(1);
    if (!c) throw new HttpError(404, "Not found");
    const [d] = c.departmentId ? await db.select({ n: A.departments.name }).from(A.departments).where(eq(A.departments.id, c.departmentId)).limit(1) : [];
    return res.json({ name: c.fullName, values: { position: c.position ?? undefined, department: d?.n, joiningDate: c.expectedJoining ?? undefined } });
  }
  if (!q.employeeId) throw new HttpError(400, "Pick a person");
  const [e] = await db.select().from(A.employees).where(eq(A.employees.id, q.employeeId)).limit(1);
  if (!e) throw new HttpError(404, "Not found");
  const one = async <T,>(p: Promise<T[]>) => (await p)[0];
  const des = e.designationId ? await one(db.select({ n: A.designations.name }).from(A.designations).where(eq(A.designations.id, e.designationId)).limit(1)) : undefined;
  const dep = e.departmentId ? await one(db.select({ n: A.departments.name }).from(A.departments).where(eq(A.departments.id, e.departmentId)).limit(1)) : undefined;
  const loc = e.locationId ? await one(db.select({ n: A.locations.name, s: A.locations.state }).from(A.locations).where(eq(A.locations.id, e.locationId)).limit(1)) : undefined;
  const mgr = e.managerId ? await one(db.select({ n: A.employees.fullName }).from(A.employees).where(eq(A.employees.id, e.managerId)).limit(1)) : undefined;
  const comp = await one(db.select({ g: A.compensation.monthlyGrossPaise }).from(A.compensation).where(eq(A.compensation.employeeId, e.id)).orderBy(desc(A.compensation.effectiveFrom)).limit(1));
  const res2 = await one(db.select({ d: A.resignations.createdAt }).from(A.resignations).where(eq(A.resignations.employeeId, e.id)).orderBy(desc(A.resignations.createdAt)).limit(1));
  const from: Record<string, unknown> = { designation: des?.n, department: dep?.n, location: loc ? `${loc.n}${loc.s ? `, ${loc.s}` : ""}` : undefined, manager: mgr?.n, joiningDate: e.joiningDate, lastWorkingDay: e.lastWorkingDay ?? undefined, monthlyGross: comp?.g };
  await logAudit(req.actor!.email, "letters.prefill", "employee", e.id);
  res.json({ name: e.fullName, code: e.code, from, resignationDate: res2 ? res2.d.toISOString().slice(0, 10) : undefined });
}));

/** Preview a letter that is not saved yet, for the form's live preview. */
r.post("/letters/preview", wrap(async (req, res) => {
  need(req, "letters.generate", "all");
  const b = parse(z.object({ type: z.enum(LETTER_TYPES), name: z.string().max(200).optional(), payload: z.record(z.unknown()).optional() }), req.body);
  const payload = b.payload ?? {};
  const ctx = await letterContext({ type: b.type, payload });
  res.type("html").send(renderLetter({ type: b.type, refNo: "CMPZ/HR/PREVIEW", name: b.name ?? "", issuedAt: null, status: "draft", payload, ...ctx }));
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
  const payload = (l.payload ?? {}) as Record<string, unknown>;
  const html = renderLetter({ type: l.type, refNo: l.refNo, name: who.name, issuedAt: l.issuedAt, status: l.status, payload, approvedAt: l.approvedAt, ...(await letterContext({ type: l.type, payload, candidateId: l.candidateId, status: l.status })) });
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

// ---------- onboarding pipeline ----------
export const PIPELINE_STAGES = ["Offer to prepare", "Offer drafted", "With the CEO", "Ready to issue", "Offer sent", "Accepted", "Joining details", "Ready to join"] as const;
r.get("/hiring/pipeline", wrap(async (req, res) => {
  need(req, "hiring.manage", "all");
  const cands = await db.select().from(A.candidates).orderBy(desc(A.candidates.createdAt));
  const lets = await db.select({ id: A.letters.id, candidateId: A.letters.candidateId, employeeId: A.letters.employeeId, type: A.letters.type, status: A.letters.status }).from(A.letters);
  const links = await db.select({ candidateId: A.acceptanceLinks.letterId }).from(A.acceptanceLinks);
  const shared = new Set(links.map((l) => l.candidateId));
  const onb = await db.select({ candidateId: A.onboardingLinks.candidateId, completedAt: A.onboardingLinks.completedAt }).from(A.onboardingLinks);
  const offerOf = (cid: string) => lets.filter((l) => l.candidateId === cid && (l.type === "offer_short" || l.type === "offer_full") && l.status !== "void");
  const stageOf = (c: (typeof cands)[number]): string | null => {
    if (c.status === "joined" || c.status === "declined") return null;
    const o = offerOf(c.id);
    const done = onb.filter((x) => x.candidateId === c.id);
    if (done.some((x) => x.completedAt)) return "Ready to join";
    if (done.length) return "Joining details";
    if (c.status === "accepted" || o.some((l) => l.status === "accepted")) return "Accepted";
    if (o.some((l) => l.status === "issued")) return o.some((l) => shared.has(l.id)) ? "Offer sent" : "Ready to issue";
    if (o.length && o.every((l) => l.status === "approved")) return "Ready to issue";
    if (o.some((l) => l.status === "pending_approval")) return "With the CEO";
    if (o.length) return "Offer drafted";
    return "Offer to prepare";
  };
  const pipeline = cands.map((c) => ({ id: c.id, name: c.fullName, position: c.position, expectedJoining: c.expectedJoining, status: c.status, stage: stageOf(c), createdAt: c.createdAt })).filter((c) => c.stage);

  // First 45 days after joining: what is still open for each new joiner.
  const since = new Date(Date.now() - 45 * 86400_000).toISOString().slice(0, 10);
  const joiners = await db.select().from(A.employees).where(and(sql`${A.employees.joiningDate} >= ${since}`, inArray(A.employees.status, ["active", "notice"])));
  const ids = joiners.map((e) => e.id);
  const comp = ids.length ? await db.select({ e: A.compensation.employeeId }).from(A.compensation).where(inArray(A.compensation.employeeId, ids)) : [];
  const assets = ids.length ? await db.select({ e: A.assetAssignments.employeeId }).from(A.assetAssignments).where(inArray(A.assetAssignments.employeeId, ids)) : [];
  const acks = ids.length ? await db.select({ e: A.policyAcks.employeeId, n: sql<number>`count(*)::int` }).from(A.policyAcks).where(inArray(A.policyAcks.employeeId, ids)).groupBy(A.policyAcks.employeeId) : [];
  const [{ policies }] = await db.select({ policies: sql<number>`count(*)::int` }).from(A.policies);
  const consents = ids.length ? await db.select({ s: A.consentEvents.subjectId }).from(A.consentEvents).where(inArray(A.consentEvents.subjectId, ids.map((x) => "emp_" + x))) : [];
  const newJoiners = joiners.map((e) => {
    const steps = {
      profile: !!e.profileCompletedAt, manager: !!e.managerId, salary: comp.some((x) => x.e === e.id),
      appointment: lets.some((l) => l.employeeId === e.id && l.type === "appointment" && ["issued", "accepted"].includes(l.status)),
      asset: assets.some((x) => x.e === e.id), policies: policies > 0 && (acks.find((x) => x.e === e.id)?.n ?? 0) >= policies,
      privacy: consents.some((x) => x.s === "emp_" + e.id),
    };
    return { id: e.id, name: e.fullName, code: e.code, joiningDate: e.joiningDate, steps, done: Object.values(steps).filter(Boolean).length, total: Object.keys(steps).length };
  });
  res.json({ stages: PIPELINE_STAGES, pipeline, newJoiners });
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
    // The consents chosen on the offer acceptance page move to the employee's consent log.
    const carried = await carryOfferConsents(tx, id, e.id);
    return { ...e, carried };
  });
  await logAudit(req.actor!.email, "candidate.convert", "employee", emp.id, { candidateId: id, code: emp.code, consentsCarried: emp.carried });
  res.status(201).json({ id: emp.id, code: emp.code, consentsCarried: emp.carried });
}));

export default r;
