import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "../db";
import { wrap, parse, HttpError } from "./util";
import { logAudit } from "../lib/audit";
import { need, idParam, istDate, monthRange } from "../lib/routeHelpers";
import { FNF_DEFAULTS, computeFnf, payBy, type FnfInput, type FnfRules } from "../../shared/hr/fnf";
import { resolveComponents, type ComponentDef } from "../../shared/hr/payroll";
import { entitlementX2, balanceX2 } from "../../shared/hr/leave";
import { letterRef } from "../../shared/hr/misc";
import { usage } from "./time";
import { sql } from "drizzle-orm";

/** Full and final settlement: HR works it out from the records, can adjust, and turns it into a statement letter for CEO approval. */
const r = Router();
const A = schema;
const hr = (req: Parameters<typeof need>[0]) => need(req, "resign.accept", "all");

async function rules(): Promise<FnfRules> {
  const [row] = await db.select().from(A.fnfRules).orderBy(desc(A.fnfRules.id)).limit(1);
  const s = (row?.settings ?? {}) as Partial<FnfRules>;
  return { ...FNF_DEFAULTS, ...s, gratuity: { ...FNF_DEFAULTS.gratuity, ...(s.gratuity ?? {}) } };
}
const rulesSchema = z.object({
  encashLeaveKeys: z.array(z.string().max(40)).max(20), encashMaxDays: z.number().int().min(0).max(365), encashBasis: z.enum(["basic", "gross"]), dayDivisor: z.number().int().min(20).max(31),
  noticeRecovery: z.boolean(), noticeBasis: z.enum(["basic", "gross"]), payNoticeIfCompanyEnds: z.boolean(),
  gratuity: z.object({ enabled: z.boolean(), minYears: z.number().min(0).max(10), capPaise: z.number().int().min(0) }), payWithinWorkingDays: z.number().int().min(0).max(60),
}).strict();
r.get("/fnf/rules", wrap(async (req, res) => { hr(req); res.json(await rules()); }));
r.put("/fnf/rules", wrap(async (req, res) => {
  hr(req);
  const b = parse(rulesSchema, req.body);
  await db.insert(A.fnfRules).values({ settings: b, updatedBy: req.actor!.email });
  await logAudit(req.actor!.email, "fnf.rules.update");
  res.json(b);
}));

/** Everything the records say, as a starting point HR can override. */
async function draftInputs(employeeId: string, rs: FnfRules) {
  const [e] = await db.select().from(A.employees).where(eq(A.employees.id, employeeId)).limit(1);
  if (!e) throw new HttpError(404, "Employee not found");
  const [res2] = await db.select().from(A.resignations).where(and(eq(A.resignations.employeeId, e.id), inArray(A.resignations.status, ["accepted", "completed", "manager_reviewed", "submitted"]))).orderBy(desc(A.resignations.createdAt)).limit(1);
  const lwd = e.lastWorkingDay ?? res2?.agreedLastDay ?? res2?.proposedLastDay ?? istDate();
  const [comp] = await db.select().from(A.compensation).where(eq(A.compensation.employeeId, e.id)).orderBy(desc(A.compensation.effectiveFrom)).limit(1);
  const gross = comp?.monthlyGrossPaise ?? 0;
  let basic = 0;
  try { basic = resolveComponents(gross, (comp?.components ?? []) as ComponentDef[]).find((l) => l.code === "BASIC")?.amount ?? Math.round(gross / 2); } catch { basic = Math.round(gross / 2); }
  // Unpaid days: days of the last month not covered by a locked or paid payroll run.
  const month = lwd.slice(0, 7); const { from } = monthRange(month);
  const [run] = await db.select({ id: A.payrollRuns.id }).from(A.payrollRuns).innerJoin(A.payslips, eq(A.payslips.runId, A.payrollRuns.id)).where(and(eq(A.payrollRuns.month, month), eq(A.payslips.employeeId, e.id), inArray(A.payrollRuns.status, ["locked", "paid"]))).limit(1);
  const calendarDays = Number(monthRange(month).to.slice(8));
  const unpaidDays = run ? 0 : Math.max(0, Number(lwd.slice(8)) - (e.joiningDate > from ? Number(e.joiningDate.slice(8)) - 1 : 0));
  // Encashable leave: balance of the configured leave types on the last day.
  const types = await db.select().from(A.leaveTypes).where(eq(A.leaveTypes.active, true));
  let leaveX2 = 0; const leaveNotes: string[] = [];
  for (const t of types.filter((t) => t.paid && rs.encashLeaveKeys.includes(t.key))) {
    const u = await usage(e.id, Number(lwd.slice(0, 4)), t.id);
    const ent = entitlementX2({ annualQuotaHalfDays: t.annualQuotaHalfDays, carryForwardHalfDays: t.carryForwardHalfDays, accrual: t.accrual as "upfront" | "monthly" }, lwd, e.joiningDate);
    const bal = Math.max(0, balanceX2(ent, u.approved, 0).available ?? 0);
    if (bal) { leaveX2 += bal; leaveNotes.push(`${t.name} ${bal / 2}`); }
  }
  // Notice: what was asked for against what was served.
  const noticeRequiredDays = res2?.noticeDays ?? 30;
  const servedDays = res2 ? Math.max(0, Math.round((Date.parse(lwd + "T00:00:00Z") - res2.createdAt.getTime()) / 86400000)) : noticeRequiredDays;
  // Assets not returned and approved claims not yet paid.
  const open = await db.select({ tag: A.assets.tag, category: A.assets.category, cost: A.assets.costPaise }).from(A.assetAssignments).innerJoin(A.assets, eq(A.assets.id, A.assetAssignments.assetId)).where(and(eq(A.assetAssignments.employeeId, e.id), isNull(A.assetAssignments.returnedOn)));
  const [claims] = await db.select({ amt: sql<number>`coalesce(sum(${A.reimbClaims.amountPaise}),0)::int` }).from(A.reimbClaims).where(and(eq(A.reimbClaims.employeeId, e.id), eq(A.reimbClaims.status, "approved")));
  const input: FnfInput = {
    monthlyGrossPaise: gross, monthlyBasicPaise: basic, joiningDate: e.joiningDate, lastWorkingDay: lwd, unpaidDays, calendarDays,
    encashableLeaveDays: leaveX2 / 2, noticeRequiredDays, noticeServedDays: Math.min(servedDays, noticeRequiredDays), waiveNotice: false,
    extraEarnings: claims?.amt ? [{ label: "Approved reimbursements not yet paid", amountPaise: claims.amt }] : [],
    deductions: open.map((a) => ({ label: `Asset not returned: ${a.category} ${a.tag}`, amountPaise: a.cost ?? 0, note: "Remove this line once it is returned" })),
  };
  return { employee: { id: e.id, name: e.fullName, code: e.code, joiningDate: e.joiningDate, status: e.status }, input, notes: { leave: leaveNotes.join(", "), resignation: !!res2, salaryFound: !!comp } };
}

r.get("/fnf", wrap(async (req, res) => {
  hr(req);
  const rows = await db.select({ s: A.fnfSettlements, name: A.employees.fullName, code: A.employees.code }).from(A.fnfSettlements).innerJoin(A.employees, eq(A.employees.id, A.fnfSettlements.employeeId)).orderBy(desc(A.fnfSettlements.createdAt));
  const due = await db.select({ id: A.employees.id, name: A.employees.fullName, code: A.employees.code, status: A.employees.status, lwd: A.employees.lastWorkingDay }).from(A.employees).where(inArray(A.employees.status, ["notice", "exited"]));
  const done = new Set(rows.map((x) => x.s.employeeId));
  res.json({ settlements: rows.map((x) => ({ ...x.s, name: x.name, code: x.code })), due: due.filter((d) => !done.has(d.id)) });
}));
r.get("/fnf/draft/:id", wrap(async (req, res) => {
  hr(req);
  const rs = await rules();
  const d = await draftInputs(idParam(req), rs);
  res.json({ ...d, rules: rs, result: computeFnf(d.input, rs), payBy: payBy(d.input.lastWorkingDay, rs.payWithinWorkingDays) });
}));
const line = z.object({ label: z.string().trim().min(1).max(120), amountPaise: z.number().int().min(0), note: z.string().max(200).optional() });
const inputSchema = z.object({
  monthlyGrossPaise: z.number().int().min(0), monthlyBasicPaise: z.number().int().min(0), joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), lastWorkingDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  unpaidDays: z.number().min(0).max(31), calendarDays: z.number().int().min(28).max(31), encashableLeaveDays: z.number().min(0).max(365),
  noticeRequiredDays: z.number().int().min(0).max(365), noticeServedDays: z.number().int().min(0).max(365), waiveNotice: z.boolean(),
  extraEarnings: z.array(line).max(20), deductions: z.array(line).max(20),
}).strict();
r.post("/fnf/compute", wrap(async (req, res) => {
  hr(req);
  const b = parse(inputSchema, req.body);
  const rs = await rules();
  res.json({ result: computeFnf(b, rs), payBy: payBy(b.lastWorkingDay, rs.payWithinWorkingDays) });
}));
r.post("/fnf/:id", wrap(async (req, res) => {
  hr(req);
  const employeeId = idParam(req);
  const b = parse(inputSchema, req.body);
  const rs = await rules();
  const result = computeFnf(b, rs);
  const [e] = await db.select().from(A.employees).where(eq(A.employees.id, employeeId)).limit(1);
  if (!e) throw new HttpError(404, "Employee not found");
  const [des] = e.designationId ? await db.select({ n: A.designations.name }).from(A.designations).where(eq(A.designations.id, e.designationId)).limit(1) : [];
  const fnf = { ...result, lastWorkingDay: b.lastWorkingDay, joiningDate: b.joiningDate, payBy: payBy(b.lastWorkingDay, rs.payWithinWorkingDays), position: des?.n, code: e.code };
  const out = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(7101)`);
    const year = new Date().getUTCFullYear();
    const res2 = await tx.execute(sql`select coalesce(max(cast(split_part(ref_no, '/', 4) as integer)), 0) as m from hr_letters where ref_no like ${`CMPZ/HR/${year}/%`}`);
    const max = Number((res2.rows[0] as { m: number | string } | undefined)?.m ?? 0);
    const [letter] = await tx.insert(A.letters).values({ type: "fnf_statement", refNo: letterRef(year, max + 1), employeeId, payload: { fnf }, createdBy: req.actor!.email, status: "pending_approval", submittedBy: req.actor!.email, submittedAt: new Date() }).returning();
    const [s] = await tx.insert(A.fnfSettlements).values({ employeeId, inputs: b, result: fnf, rules: rs, letterId: letter.id, createdBy: req.actor!.email }).returning();
    return { settlement: s, letter };
  });
  await logAudit(req.actor!.email, "fnf.create", "employee", employeeId, { netPaise: result.netPaise, letter: out.letter.refNo });
  res.status(201).json(out);
}));
r.post("/fnf/:id/paid", wrap(async (req, res) => {
  hr(req);
  const b = parse(z.object({ paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }), req.body);
  const [row] = await db.update(A.fnfSettlements).set({ status: "paid", paidOn: b.paidOn }).where(eq(A.fnfSettlements.id, idParam(req))).returning();
  if (!row) throw new HttpError(404, "Not found");
  await logAudit(req.actor!.email, "fnf.paid", "fnf", row.id);
  res.json(row);
}));

export default r;
