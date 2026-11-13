import { Router, type Request } from "express";
import { z } from "zod";
import { and, desc, eq, inArray, gte } from "drizzle-orm";
import { db, schema } from "../db";
import { scopeFor, canAccess } from "../../shared/hr/access";
import { checkClaim, type ReimbPolicy } from "../../shared/hr/reimbursement";
import { logAudit } from "../lib/audit";
import { saveFile, readFileBytes } from "../lib/files";
import { HttpError, parse, wrap } from "./util";
import { aggregateClaims, approverTier, lastMonths, nextApprovalStatus, policySchema, type ClaimStatus } from "./reimbursementHelpers";

/**
 * Approval flow (documented choice, no extra role needed):
 *   submitted -> verified (finance_signatory)
 *   verified  -> approved: finance tier = finance; manager tier = the claimant's manager
 *   ceo tier: verified -> manager_approved (manager) -> approved (hr_admin records the CEO sign-off; a note is mandatory)
 * Tier comes from the current policy thresholds. Nobody can act on their own claim.
 */
const r = Router();
const actorOf = (req: Request) => req.actor!;
const deny = (): never => { throw new HttpError(403, "Not allowed"); };
const uuid = z.string().uuid();
const idParam = (req: Request) => { const p = uuid.safeParse(req.params.id); if (!p.success) throw new HttpError(400, "Invalid id"); return p.data; };
const todayIst = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const monthRe = /^\d{4}-(0[1-9]|1[0-2])$/;
const STATUSES = ["submitted", "verified", "manager_approved", "approved", "rejected", "paid"] as const;

async function getPolicy(): Promise<ReimbPolicy | null> {
  const [row] = await db.select().from(schema.reimbursementPolicy).orderBy(desc(schema.reimbursementPolicy.id)).limit(1);
  if (!row) return null;
  const p = policySchema.safeParse(row.settings);
  return p.success ? (p.data as ReimbPolicy) : null;
}
async function needPolicy(): Promise<ReimbPolicy> {
  const p = await getPolicy();
  if (!p) throw new HttpError(422, "The reimbursement policy has not been configured yet. Ask HR or finance to set it up.");
  return p;
}

// ============================================================ policy
r.get("/reimbursement/policy", wrap(async (_req, res) => {
  const [row] = await db.select().from(schema.reimbursementPolicy).orderBy(desc(schema.reimbursementPolicy.id)).limit(1);
  res.json(row ? { configured: true, settings: row.settings, updatedBy: row.updatedBy, updatedAt: row.updatedAt } : { configured: false, settings: null });
}));

r.put("/reimbursement/policy", wrap(async (req, res) => {
  const a = actorOf(req);
  if (scopeFor(a.roles, "policy.reimb.edit") !== "all") deny();
  const settings = parse(policySchema, req.body?.settings ?? req.body);
  const [row] = await db.insert(schema.reimbursementPolicy).values({ settings, updatedBy: a.email }).returning();
  await logAudit(a.email, "reimbursement.policy.update", "reimbursement_policy", String(row.id), settings);
  res.json({ configured: true, settings: row.settings, updatedBy: row.updatedBy, updatedAt: row.updatedAt });
}));

// ============================================================ employee claims
const claimBody = z.object({
  category: z.enum(["travel", "expense", "technology"]),
  mode: z.string().trim().min(1).max(40).optional(),
  description: z.string().trim().min(1).max(500),
  distanceKm: z.number().int().positive().max(100000).optional(),
  amountPaise: z.number().int().positive().max(1_000_000_00_00),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  month: z.string().regex(monthRe),
  bill: z.object({ name: z.string().trim().min(1).max(120), mime: z.enum(["application/pdf", "image/png", "image/jpeg", "image/webp"]), dataBase64: z.string().min(16).max(14_000_000) }).optional(),
});

r.post("/reimbursement/claims", wrap(async (req, res) => {
  const a = actorOf(req);
  if (!a.employeeId) throw new HttpError(403, "Only employees can submit claims");
  const b = parse(claimBody, req.body);
  if (Number.isNaN(Date.parse(b.expenseDate))) throw new HttpError(400, "Invalid expense date");
  const policy = await needPolicy();
  const check = checkClaim({ category: b.category, mode: b.mode, distanceKm: b.distanceKm, amountPaise: b.amountPaise, hasBill: !!b.bill, expenseDate: b.expenseDate, submittedOn: todayIst(), month: b.month }, policy);
  const blocking = check.flags.filter((f) => f.blocking);
  if (blocking.length) return res.status(400).json({ error: "Claim does not meet policy", flags: check.flags, expectedAmountPaise: check.expectedAmountPaise });
  let billFileId: string | undefined;
  if (b.bill) {
    try { billFileId = (await saveFile({ kind: "bill", buf: Buffer.from(b.bill.dataBase64.replace(/^data:[^,]+,/, ""), "base64"), name: b.bill.name, mime: b.bill.mime, uploadedBy: a.email, ownerEmployeeId: a.employeeId })).id; }
    catch (e) { throw new HttpError(400, (e as Error).message); }
  }
  const [row] = await db.insert(schema.reimbClaims).values({
    employeeId: a.employeeId, month: b.month, category: b.category, mode: b.mode, description: b.description, distanceKm: b.distanceKm, amountPaise: b.amountPaise,
    expenseDate: b.expenseDate, billFileId, status: "submitted", policyFlags: check.flags,
  }).returning();
  await logAudit(a.email, "reimbursement.claim.create", "reimb_claim", row.id, { amountPaise: b.amountPaise, category: b.category, month: b.month });
  res.status(201).json({ ...row, approver: check.approver, flags: check.flags });
}));

r.get("/me/reimbursements", wrap(async (req, res) => {
  const a = actorOf(req);
  if (!a.employeeId) return res.json({ months: [] });
  const claims = await db.select().from(schema.reimbClaims).where(eq(schema.reimbClaims.employeeId, a.employeeId)).orderBy(desc(schema.reimbClaims.month), desc(schema.reimbClaims.createdAt));
  const slips = await db.select({ month: schema.payrollRuns.month, net: schema.payslips.netPayPaise, result: schema.payslips.result }).from(schema.payslips)
    .innerJoin(schema.payrollRuns, eq(schema.payslips.runId, schema.payrollRuns.id))
    .where(and(eq(schema.payslips.employeeId, a.employeeId), inArray(schema.payrollRuns.status, ["locked", "paid"])));
  const slipBy = new Map(slips.map((s) => [s.month, s]));
  const groups = new Map<string, typeof claims>();
  for (const c of claims) groups.set(c.month, [...(groups.get(c.month) ?? []), c]);
  const months = [...groups.entries()].map(([month, list]) => {
    const live = list.filter((c) => c.status !== "rejected");
    const slip = slipBy.get(month);
    return {
      month,
      totalPaise: live.reduce((s, c) => s + c.amountPaise, 0),
      approvedPaise: list.filter((c) => c.status === "approved" || c.status === "paid").reduce((s, c) => s + c.amountPaise, 0),
      paidPaise: list.filter((c) => c.status === "paid").reduce((s, c) => s + c.amountPaise, 0),
      netSalaryPaise: slip ? slip.net : null, // that month's net pay (includes reimbursements paid in that run), once the run is locked
      claims: list,
    };
  });
  res.json({ months });
}));

// ============================================================ review
/** Visible claims for the actor: finance/hr all, managers their reports (+ own), employees own. */
function visibility(req: Request) {
  const a = actorOf(req);
  const scope = scopeFor(a.roles, "claims.read");
  if (scope === "all") return { all: true as const, ids: [] as string[] };
  const ids = scope === "reports" ? [...a.directReportIds, ...(a.employeeId ? [a.employeeId] : [])] : scope === "own" && a.employeeId ? [a.employeeId] : [];
  return { all: false as const, ids };
}

r.get("/reimbursement/claims", wrap(async (req, res) => {
  const q = parse(z.object({ status: z.enum(STATUSES).optional(), month: z.string().regex(monthRe).optional() }), req.query);
  const v = visibility(req);
  if (!v.all && !v.ids.length) return res.json([]);
  const conds = [q.status ? eq(schema.reimbClaims.status, q.status) : undefined, q.month ? eq(schema.reimbClaims.month, q.month) : undefined, v.all ? undefined : inArray(schema.reimbClaims.employeeId, v.ids)].filter(Boolean) as ReturnType<typeof eq>[];
  const rows = await db.select({ c: schema.reimbClaims, code: schema.employees.code, name: schema.employees.fullName, dept: schema.departments.name }).from(schema.reimbClaims)
    .innerJoin(schema.employees, eq(schema.reimbClaims.employeeId, schema.employees.id)).leftJoin(schema.departments, eq(schema.employees.departmentId, schema.departments.id))
    .where(conds.length ? and(...conds) : undefined).orderBy(desc(schema.reimbClaims.createdAt)).limit(500);
  const policy = await getPolicy();
  res.json(rows.map((x) => ({ ...x.c, hasBill: !!x.c.billFileId, billFileId: undefined, employee: { code: x.code, name: x.name, department: x.dept }, approverTier: policy ? approverTier(x.c.amountPaise, policy) : null })));
}));

async function loadClaim(req: Request) {
  const [c] = await db.select().from(schema.reimbClaims).where(eq(schema.reimbClaims.id, idParam(req))).limit(1);
  if (!c) throw new HttpError(404, "Claim not found");
  return c;
}
const noSelf = (req: Request, employeeId: string) => { if (actorOf(req).employeeId === employeeId) throw new HttpError(403, "You cannot act on your own claim"); };
const noteBody = z.object({ note: z.string().trim().min(1).max(500).optional() });

r.get("/reimbursement/claims/:id/bill", wrap(async (req, res) => {
  const a = actorOf(req);
  const c = await loadClaim(req);
  if (!canAccess(scopeFor(a.roles, "claims.read"), a, c.employeeId) || !c.billFileId) throw new HttpError(404, "Bill not found");
  const [f] = await db.select().from(schema.files).where(eq(schema.files.id, c.billFileId)).limit(1);
  if (!f) throw new HttpError(404, "Bill not found");
  if (a.employeeId !== c.employeeId) await logAudit(a.email, "reimbursement.bill.read", "reimb_claim", c.id);
  res.setHeader("Content-Disposition", `inline; filename="${f.originalName.replace(/[^\w.\-]/g, "_")}"`);
  res.setHeader("Content-Security-Policy", "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox");
  res.type(f.mime).send(await readFileBytes(f.storageKey));
}));

r.post("/reimbursement/claims/:id/verify", wrap(async (req, res) => {
  const a = actorOf(req);
  if (scopeFor(a.roles, "claims.verify") !== "all") deny();
  const c = await loadClaim(req);
  noSelf(req, c.employeeId);
  const { note } = parse(noteBody, req.body ?? {});
  if (c.status !== "submitted") throw new HttpError(409, `Claim is ${c.status}, only submitted claims can be verified`);
  const [row] = await db.update(schema.reimbClaims).set({ status: "verified", verifiedBy: a.email, decisionNote: note ?? c.decisionNote }).where(and(eq(schema.reimbClaims.id, c.id), eq(schema.reimbClaims.status, "submitted"))).returning();
  if (!row) throw new HttpError(409, "Claim changed; reload");
  await logAudit(a.email, "reimbursement.claim.verify", "reimb_claim", c.id);
  res.json(row);
}));

r.post("/reimbursement/claims/:id/approve", wrap(async (req, res) => {
  const a = actorOf(req);
  const c = await loadClaim(req);
  noSelf(req, c.employeeId);
  const { note } = parse(noteBody, req.body ?? {});
  const policy = await needPolicy();
  const tier = approverTier(c.amountPaise, policy);
  const [emp] = await db.select({ managerId: schema.employees.managerId }).from(schema.employees).where(eq(schema.employees.id, c.employeeId)).limit(1);

  // Pick the role the actor is acting in for this step.
  const isManagerOf = scopeFor(a.roles, "claims.approve") === "reports" && a.directReportIds.includes(c.employeeId);
  const isFinance = scopeFor(a.roles, "claims.verify") === "all";
  const isHr = scopeFor(a.roles, "policy.reimb.edit") === "all" && a.roles.has("hr_admin");
  let next: ClaimStatus | null = null;
  let role: "manager" | "finance" | "hr_admin" | null = null;
  for (const cand of [isManagerOf && "manager", isFinance && "finance", isHr && "hr_admin"] as const) {
    if (!cand) continue;
    const n = nextApprovalStatus(c.status as ClaimStatus, tier, cand);
    if (n) { next = n; role = cand; break; }
  }
  // An employee without a manager on record: hr_admin may stand in for the manager, with a note.
  if (!next && !emp?.managerId && isHr && c.status === "verified" && tier !== "finance") {
    next = tier === "ceo" ? "manager_approved" : "approved"; role = "hr_admin";
    if (!note) throw new HttpError(400, "A note is required: this employee has no manager on record");
  }
  if (!next || !role) {
    if (c.status === "submitted") throw new HttpError(409, "Finance must verify this claim first");
    throw new HttpError(403, `You cannot approve this claim at its current step (${c.status}, ${tier} approval tier)`);
  }
  if (role === "hr_admin" && next === "approved" && !note) throw new HttpError(400, "A note recording the CEO approval is required");
  const [row] = await db.update(schema.reimbClaims).set({ status: next, approvedBy: a.email, decisionNote: note ?? c.decisionNote })
    .where(and(eq(schema.reimbClaims.id, c.id), eq(schema.reimbClaims.status, c.status))).returning();
  if (!row) throw new HttpError(409, "Claim changed; reload");
  await logAudit(a.email, "reimbursement.claim.approve", "reimb_claim", c.id, { as: role, from: c.status, to: next, tier, note });
  res.json({ ...row, approverTier: tier });
}));

r.post("/reimbursement/claims/:id/reject", wrap(async (req, res) => {
  const a = actorOf(req);
  const c = await loadClaim(req);
  noSelf(req, c.employeeId);
  const { note } = parse(z.object({ note: z.string().trim().min(3).max(500) }), req.body);
  if (!["submitted", "verified", "manager_approved"].includes(c.status)) throw new HttpError(409, `Claim is ${c.status} and can no longer be rejected`);
  const allowed = scopeFor(a.roles, "claims.verify") === "all" || (scopeFor(a.roles, "claims.approve") === "reports" && a.directReportIds.includes(c.employeeId)) || (c.status === "manager_approved" && a.roles.has("hr_admin"));
  if (!allowed) deny();
  const [row] = await db.update(schema.reimbClaims).set({ status: "rejected", decisionNote: note, approvedBy: a.email }).where(and(eq(schema.reimbClaims.id, c.id), eq(schema.reimbClaims.status, c.status))).returning();
  if (!row) throw new HttpError(409, "Claim changed; reload");
  await logAudit(a.email, "reimbursement.claim.reject", "reimb_claim", c.id, { from: c.status, note });
  res.json(row);
}));

// ============================================================ analytics
r.get("/reimbursement/analytics", wrap(async (req, res) => {
  const a = actorOf(req);
  if (scopeFor(a.roles, "claims.read") !== "all") deny();
  const { months: nq } = parse(z.object({ months: z.coerce.number().int().min(1).max(24).optional() }), req.query);
  const months = lastMonths(todayIst().slice(0, 7), nq ?? 6);
  const rows = await db.select({ c: schema.reimbClaims, dept: schema.departments.name }).from(schema.reimbClaims)
    .innerJoin(schema.employees, eq(schema.reimbClaims.employeeId, schema.employees.id)).leftJoin(schema.departments, eq(schema.employees.departmentId, schema.departments.id))
    .where(gte(schema.reimbClaims.month, months[0]));
  res.json({ months, excludes: "rejected", ...aggregateClaims(rows.map((x) => ({ month: x.c.month, category: x.c.category, mode: x.c.mode, amountPaise: x.c.amountPaise, status: x.c.status, department: x.dept })), months) });
}));

export default r;
