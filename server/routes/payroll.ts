import { Router, type Request } from "express";
import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { scopeFor, canAccess } from "../../shared/hr/access";
import { computeSalary, resolveComponents, type ComponentDef, type SalaryResult, type StatutoryRules } from "../../shared/hr/payroll";
import { buildAdvice, toCsv, type AdviceRow } from "../../shared/hr/bankAdvice";
import { paidDaysX2 } from "../../shared/hr/leave";
import { decryptField, safeEqualHex } from "../lib/crypto";
import { logAudit } from "../lib/audit";
import { saveFile, readFileBytes } from "../lib/files";
import { toXlsx } from "../lib/xlsx";
import { readSheet } from "../lib/xlsxRead";
import { IMPORT_COLUMNS, daysInMonth, parseImport } from "../../shared/hr/payrollImport";
import { HttpError, parse, wrap } from "./util";
import {
  MONTH_RE, componentsSchema, employmentGapX2, employmentWindow, fyStartMonth, lossOfPayX2, maskAccount, maskedRows, monthDays, monthEnd,
  monthStart, monthsRemainingInFy, nextAdviceRef, normaliseCalendar, renderAdviceHtml, renderPayslipHtml, rulesSchema, safeFileName,
  sumTdsYtd, sumGrossYtd, totalsOf,
} from "./payrollHelpers";

const r = Router();

const COMPANY = "Complynz";
const SAMPLE_GROSS_PAISE = 1_000_000_00; // sample gross used only to validate a component set resolves cleanly

const actorOf = (req: Request) => req.actor!;
/** hr_admin or finance signatory. */
const canViewPayroll = (req: Request) => scopeFor(actorOf(req).roles, "bank_advice.generate") === "all";
/** hr_admin or finance signatory: salary templates, compensation, runs and locking. */
const canRunPayroll = (req: Request) => scopeFor(actorOf(req).roles, "payroll.run") === "all";
const deny = (): never => { throw new HttpError(403, "Not allowed"); };
const uuid = z.string().uuid();
const idParam = (req: Request, name = "id") => { const p = uuid.safeParse(req.params[name]); if (!p.success) throw new HttpError(400, "Invalid id"); return p.data; };
const todayIst = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(s)), "Invalid date");

// ============================================================ statutory rules
async function rulesForMonth(month: string) {
  const [row] = await db.select().from(schema.statutoryRules).where(lte(schema.statutoryRules.effectiveFrom, monthStart(month))).orderBy(desc(schema.statutoryRules.effectiveFrom), desc(schema.statutoryRules.createdAt)).limit(1);
  if (!row) throw new HttpError(422, `No statutory rules are configured as effective on or before ${monthStart(month)}. Add them under Payroll > Statutory rules (with the source where the values were confirmed) before creating a payroll run.`);
  const parsed = rulesSchema.safeParse(row.rules);
  if (!parsed.success) throw new HttpError(422, "The stored statutory rules are invalid; add a corrected rule set");
  return { row, rules: parsed.data as StatutoryRules };
}

r.get("/payroll/rules", wrap(async (req, res) => {
  if (!canViewPayroll(req)) deny();
  const history = await db.select().from(schema.statutoryRules).orderBy(desc(schema.statutoryRules.effectiveFrom), desc(schema.statutoryRules.createdAt));
  const today = todayIst();
  res.json({ current: history.find((h) => h.effectiveFrom <= today) ?? null, history });
}));

r.post("/payroll/rules", wrap(async (req, res) => {
  if (!canViewPayroll(req)) deny();
  const body = parse(z.object({ effectiveFrom: isoDate, rules: rulesSchema, source: z.string().trim().min(5).max(500) }), req.body);
  const [dup] = await db.select({ id: schema.statutoryRules.id }).from(schema.statutoryRules).where(eq(schema.statutoryRules.effectiveFrom, body.effectiveFrom)).limit(1);
  if (dup) throw new HttpError(409, "A rule set already exists for that effective date; use a later date for a revision");
  const [row] = await db.insert(schema.statutoryRules).values({ effectiveFrom: body.effectiveFrom, rules: body.rules, source: body.source, createdBy: actorOf(req).email }).returning();
  await logAudit(actorOf(req).email, "payroll.rules.create", "statutory_rules", row.id, { effectiveFrom: body.effectiveFrom, source: body.source });
  res.status(201).json(row);
}));

/** Minimal employee list for the payroll screens, so finance can pick people without seeing personal details. */
r.get("/payroll/employees", wrap(async (req, res) => {
  if (!canRunPayroll(req)) deny();
  const rows = await db.select({ id: schema.employees.id, code: schema.employees.code, fullName: schema.employees.fullName, status: schema.employees.status })
    .from(schema.employees).orderBy(asc(schema.employees.code));
  res.json({ employees: rows });
}));

/** Set-up checklist and a 12-month status strip for the Payroll overview. */
r.get("/payroll/overview", wrap(async (req, res) => {
  if (!canViewPayroll(req)) deny();
  const today = todayIst(), thisMonth = today.slice(0, 7);
  const months: string[] = [];
  { let y = Number(thisMonth.slice(0, 4)), m = Number(thisMonth.slice(5, 7)); for (let i = 0; i < 12; i++) { months.unshift(`${y}-${String(m).padStart(2, "0")}`); if (--m === 0) { m = 12; y--; } } }
  const [rule] = await db.select({ effectiveFrom: schema.statutoryRules.effectiveFrom }).from(schema.statutoryRules).where(lte(schema.statutoryRules.effectiveFrom, monthStart(thisMonth))).orderBy(desc(schema.statutoryRules.effectiveFrom)).limit(1);
  const [{ n: templates }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.salaryTemplates);
  const active = await db.select({ id: schema.employees.id, code: schema.employees.code, fullName: schema.employees.fullName }).from(schema.employees).where(inArray(schema.employees.status, ["active", "notice"]));
  const withComp = new Set((await db.selectDistinct({ id: schema.compensation.employeeId }).from(schema.compensation)).map((x) => x.id));
  const sigs = await db.select().from(schema.signatories);
  const runs = await db.select().from(schema.payrollRuns).where(inArray(schema.payrollRuns.month, months));
  const agg = runs.length ? await db.select({ runId: schema.payslips.runId, n: sql<number>`count(*)::int`, net: sql<number>`coalesce(sum(${schema.payslips.netPayPaise}),0)::bigint` })
    .from(schema.payslips).where(inArray(schema.payslips.runId, runs.map((x) => x.id))).groupBy(schema.payslips.runId) : [];
  const by = new Map(agg.map((a) => [a.runId, a]));
  const missingComp = active.filter((e) => !withComp.has(e.id));
  res.json({
    month: thisMonth,
    setup: [
      { key: "rules", label: "Statutory rule set covering this month", ok: !!rule, detail: rule ? `Effective from ${rule.effectiveFrom}` : "None yet. Add PF, ESI, TDS and professional tax values under Statutory rules.", tab: "rules" },
      { key: "templates", label: "Salary templates", ok: templates > 0, detail: templates ? `${templates} template${templates > 1 ? "s" : ""}` : "No salary structure yet.", tab: "templates" },
      { key: "comp", label: "Compensation for every active employee", ok: missingComp.length === 0, detail: missingComp.length ? `${missingComp.length} missing: ${missingComp.slice(0, 4).map((e) => e.fullName).join(", ")}${missingComp.length > 4 ? "…" : ""}` : `${active.length} of ${active.length} set`, tab: "comp" },
      { key: "sign", label: "Signatory with signature and stamp", ok: sigs.some((x) => x.signatureFileId && x.stampFileId), detail: sigs.length ? `${sigs.length} signator${sigs.length > 1 ? "ies" : "y"}` : "No signatory yet.", tab: "sign" },
    ],
    strip: months.map((m) => {
      const run = runs.find((x) => x.month === m);
      const a = run ? by.get(run.id) : undefined;
      const imported = !!run && (run.rulesSnapshot as { imported?: boolean } | null)?.imported === true;
      return { month: m, status: run ? (imported ? "imported" : run.status) : "none", runId: run?.id ?? null, payslips: a?.n ?? 0, netPayPaise: Number(a?.net ?? 0) };
    }),
  });
}));

// ============================================================ import past months (paid outside the HRMS)
const MONTH_ONLY = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
async function employedIn(month: string) {
  const from = `${month}-01`, to = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
  const rows = await db.select({ id: schema.employees.id, code: schema.employees.code, fullName: schema.employees.fullName, joiningDate: schema.employees.joiningDate, status: schema.employees.status, lastWorkingDay: schema.employees.lastWorkingDay })
    .from(schema.employees).orderBy(asc(schema.employees.code));
  return rows.filter((e) => e.joiningDate <= to && !(e.status === "exited" && e.lastWorkingDay && e.lastWorkingDay < from));
}
function pastMonth(month: string) { if (month >= todayIst().slice(0, 7)) throw new HttpError(400, "Only past months can be imported"); }

r.get("/payroll/import/template", wrap(async (req, res) => {
  if (!canRunPayroll(req)) deny();
  const { month } = parse(z.object({ month: MONTH_ONLY }), req.query);
  pastMonth(month);
  const emps = await employedIn(month);
  const cal = daysInMonth(month);
  const buf = toXlsx([
    { name: `Payroll ${month}`, header: IMPORT_COLUMNS.map((c) => c.label), rows: emps.map((e) => IMPORT_COLUMNS.map((c) => c.key === "code" ? e.code : c.key === "name" ? e.fullName : c.key === "paidDays" || c.key === "calendarDays" ? cal : "")) },
    { name: "How to fill", header: ["Notes"], rows: [
      [`One row per person paid for ${month}. Enter what was actually paid, in rupees (e.g. 31000 or 31,000.50).`],
      ["Leave a cell blank for zero. Paid days can use halves (e.g. 29.5)."],
      ["Net pay must equal earnings plus reimbursements minus deductions; leave it blank to have it worked out."],
      ["Do not rename or remove the column headings. Rows for people not paid that month can be deleted."],
    ] },
  ]);
  await logAudit(actorOf(req).email, "payroll.import.template", "payroll_run", undefined, { month });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="complynz-payroll-${month}.xlsx"`);
  res.send(buf);
}));

const importBody = z.object({ month: MONTH_ONLY, fileBase64: z.string().min(10).max(8_000_000) });
async function parseUpload(b: z.infer<typeof importBody>) {
  pastMonth(b.month);
  const [existing] = await db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.month, b.month)).limit(1);
  const existingImported = !!existing && (existing.rulesSnapshot as { imported?: boolean } | null)?.imported === true;
  if (existing && !existingImported) throw new HttpError(409, `${b.month} already has a ${existing.status} payroll run in the system, so it cannot be imported`);
  let rows: string[][];
  try { rows = readSheet(Buffer.from(b.fileBase64.replace(/^data:[^,]+,/, ""), "base64")); } catch (e) { throw new HttpError(400, (e as Error).message); }
  const emps = await employedIn(b.month);
  const out = parseImport(rows, b.month, new Map(emps.map((e) => [e.code.toUpperCase(), e.fullName])));
  return { ...out, emps, existing: existingImported ? existing : null };
}

r.post("/payroll/import/preview", wrap(async (req, res) => {
  if (!canRunPayroll(req)) deny();
  const b = parse(importBody, req.body);
  const { slips, issues, emps, existing } = await parseUpload(b);
  const listed = new Set([...slips.map((x) => x.code), ...issues.map((x) => x.code)]);
  res.json({
    month: b.month, replaces: !!existing, issues,
    rows: slips.map((x) => ({ code: x.code, name: x.name, paidDays: x.paidDaysX2 / 2, grossPaise: x.result.grossPaidPaise, deductionsPaise: x.result.totalDeductionsPaise, netPayPaise: x.result.netPayPaise })),
    totals: { payslips: slips.length, grossPaise: slips.reduce((s, x) => s + x.result.grossPaidPaise, 0), netPayPaise: slips.reduce((s, x) => s + x.result.netPayPaise, 0) },
    notInFile: emps.filter((e) => !listed.has(e.code.toUpperCase())).map((e) => `${e.fullName} (${e.code})`),
  });
}));

r.post("/payroll/import", wrap(async (req, res) => {
  if (!canRunPayroll(req)) deny();
  const b = parse(importBody, req.body);
  const { slips, issues, emps, existing } = await parseUpload(b);
  if (issues.length) throw new HttpError(400, `Fix ${issues.length} problem${issues.length > 1 ? "s" : ""} in the file first`);
  if (!slips.length) throw new HttpError(400, "The file has no payslip rows");
  const idOf = new Map(emps.map((e) => [e.code.toUpperCase(), e.id]));
  const a = actorOf(req);
  const runId = await db.transaction(async (tx) => {
    if (existing) { await tx.delete(schema.payslips).where(eq(schema.payslips.runId, existing.id)); await tx.delete(schema.payrollRuns).where(eq(schema.payrollRuns.id, existing.id)); }
    const snapshot = { imported: true, importedAt: new Date().toISOString(), importedBy: a.email, exceptions: [] };
    const [run] = await tx.insert(schema.payrollRuns).values({ month: b.month, status: "paid", rulesSnapshot: snapshot, createdBy: a.email, lockedBy: a.email, lockedAt: new Date() }).returning({ id: schema.payrollRuns.id });
    await tx.insert(schema.payslips).values(slips.map((x) => ({ runId: run.id, employeeId: idOf.get(x.code)!, paidDays: x.paidDaysX2, calendarDays: x.calendarDays, result: { ...x.result, meta: { month: b.month, imported: true } }, netPayPaise: x.result.netPayPaise })));
    return run.id;
  });
  await logAudit(a.email, existing ? "payroll.import.replace" : "payroll.import", "payroll_run", runId, { month: b.month, payslips: slips.length });
  res.status(201).json({ ok: true, runId, payslips: slips.length });
}));

/** Undo an import (only imported months; engine-built runs are never deleted). */
r.delete("/payroll/import/:id", wrap(async (req, res) => {
  if (!canRunPayroll(req)) deny();
  const [run] = await db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.id, idParam(req))).limit(1);
  if (!run || (run.rulesSnapshot as { imported?: boolean } | null)?.imported !== true) throw new HttpError(404, "Imported month not found");
  const [adv] = await db.select({ id: schema.bankAdvices.id }).from(schema.bankAdvices).where(eq(schema.bankAdvices.runId, run.id)).limit(1);
  if (adv) throw new HttpError(409, "A bank advice exists for this month");
  await db.transaction(async (tx) => { await tx.delete(schema.payslips).where(eq(schema.payslips.runId, run.id)); await tx.delete(schema.payrollRuns).where(eq(schema.payrollRuns.id, run.id)); });
  await logAudit(actorOf(req).email, "payroll.import.undo", "payroll_run", run.id, { month: run.month });
  res.json({ ok: true });
}));

// ============================================================ salary templates
function checkComponents(components: ComponentDef[]) {
  try { return resolveComponents(SAMPLE_GROSS_PAISE, components); } catch (e) { throw new HttpError(400, "Components are invalid: " + (e as Error).message); }
}
const templateBody = z.object({ name: z.string().trim().min(1).max(80), components: componentsSchema });

r.get("/payroll/templates", wrap(async (req, res) => {
  if (!canRunPayroll(req)) deny();
  res.json(await db.select().from(schema.salaryTemplates).orderBy(asc(schema.salaryTemplates.name)));
}));
r.post("/payroll/templates", wrap(async (req, res) => {
  if (!canRunPayroll(req)) deny();
  const b = parse(templateBody, req.body);
  checkComponents(b.components as ComponentDef[]);
  const [dup] = await db.select({ id: schema.salaryTemplates.id }).from(schema.salaryTemplates).where(eq(schema.salaryTemplates.name, b.name)).limit(1);
  if (dup) throw new HttpError(409, "A template with that name exists");
  const [row] = await db.insert(schema.salaryTemplates).values({ name: b.name, components: b.components }).returning();
  await logAudit(actorOf(req).email, "payroll.template.create", "salary_template", row.id, { name: b.name });
  res.status(201).json(row);
}));
r.put("/payroll/templates/:id", wrap(async (req, res) => {
  if (!canRunPayroll(req)) deny();
  const id = idParam(req);
  const b = parse(templateBody, req.body);
  checkComponents(b.components as ComponentDef[]);
  const [clash] = await db.select({ id: schema.salaryTemplates.id }).from(schema.salaryTemplates).where(eq(schema.salaryTemplates.name, b.name)).limit(1);
  if (clash && clash.id !== id) throw new HttpError(409, "A template with that name exists");
  const [row] = await db.update(schema.salaryTemplates).set({ name: b.name, components: b.components }).where(eq(schema.salaryTemplates.id, id)).returning();
  if (!row) throw new HttpError(404, "Template not found");
  await logAudit(actorOf(req).email, "payroll.template.update", "salary_template", id, { name: b.name });
  res.json(row); // existing compensation rows keep their own component snapshot
}));
r.delete("/payroll/templates/:id", wrap(async (req, res) => {
  if (!canRunPayroll(req)) deny();
  const id = idParam(req);
  const [used] = await db.select({ id: schema.compensation.id }).from(schema.compensation).where(eq(schema.compensation.templateId, id)).limit(1);
  if (used) throw new HttpError(409, "Template is used by compensation records and cannot be deleted");
  const [row] = await db.delete(schema.salaryTemplates).where(eq(schema.salaryTemplates.id, id)).returning({ id: schema.salaryTemplates.id });
  if (!row) throw new HttpError(404, "Template not found");
  await logAudit(actorOf(req).email, "payroll.template.delete", "salary_template", id);
  res.json({ ok: true });
}));

// ============================================================ compensation
r.post("/employees/:id/compensation", wrap(async (req, res) => {
  if (!canRunPayroll(req)) deny();
  const empId = idParam(req);
  const b = parse(z.object({
    effectiveFrom: isoDate, monthlyGrossPaise: z.number().int().positive().max(100_000_000_00),
    templateId: uuid.optional(), components: componentsSchema.optional(), reason: z.string().trim().min(3).max(500),
  }).refine((x) => !!x.templateId !== !!x.components, "Provide exactly one of templateId or components"), req.body);
  const [emp] = await db.select({ id: schema.employees.id }).from(schema.employees).where(eq(schema.employees.id, empId)).limit(1);
  if (!emp) throw new HttpError(404, "Employee not found");
  let components = b.components as ComponentDef[] | undefined;
  if (b.templateId) {
    const [t] = await db.select().from(schema.salaryTemplates).where(eq(schema.salaryTemplates.id, b.templateId)).limit(1);
    if (!t) throw new HttpError(404, "Template not found");
    components = t.components as ComponentDef[];
  }
  try { resolveComponents(b.monthlyGrossPaise, components!); } catch (e) { throw new HttpError(400, "Components do not work for this gross: " + (e as Error).message); }
  const [dup] = await db.select({ id: schema.compensation.id }).from(schema.compensation).where(and(eq(schema.compensation.employeeId, empId), eq(schema.compensation.effectiveFrom, b.effectiveFrom))).limit(1);
  if (dup) throw new HttpError(409, "Compensation already recorded for that effective date; use a later date for a revision");
  const [row] = await db.insert(schema.compensation).values({
    employeeId: empId, effectiveFrom: b.effectiveFrom, monthlyGrossPaise: b.monthlyGrossPaise, templateId: b.templateId, components, reason: b.reason, createdBy: actorOf(req).email,
  }).returning();
  await logAudit(actorOf(req).email, "compensation.create", "employee", empId, { effectiveFrom: b.effectiveFrom, reason: b.reason, compensationId: row.id });
  res.status(201).json(row);
}));

r.get("/employees/:id/compensation", wrap(async (req, res) => {
  const empId = idParam(req);
  const a = actorOf(req);
  if (!canAccess(scopeFor(a.roles, "comp.read"), a, empId)) deny();
  const rows = await db.select().from(schema.compensation).where(eq(schema.compensation.employeeId, empId)).orderBy(desc(schema.compensation.effectiveFrom), desc(schema.compensation.createdAt));
  if (a.employeeId !== empId) await logAudit(a.email, "compensation.read", "employee", empId);
  res.json(rows.map((c) => {
    let lines: unknown = null;
    try { lines = resolveComponents(c.monthlyGrossPaise, c.components as ComponentDef[]); } catch { /* leave null */ }
    return { ...c, lines };
  }));
}));

r.get("/payroll/preview", wrap(async (req, res) => {
  if (!canRunPayroll(req)) deny();
  const q = parse(z.object({ gross: z.coerce.number().int().positive().max(100_000_000_00), templateId: uuid }), req.query);
  const [t] = await db.select().from(schema.salaryTemplates).where(eq(schema.salaryTemplates.id, q.templateId)).limit(1);
  if (!t) throw new HttpError(404, "Template not found");
  let lines;
  try { lines = resolveComponents(q.gross, t.components as ComponentDef[]); } catch (e) { throw new HttpError(400, (e as Error).message); }
  res.json({ monthlyGrossPaise: q.gross, templateId: t.id, lines });
}));

// ============================================================ payroll runs
interface RunException { employeeId: string; code: string; name: string; message: string }
interface RunSnapshot { rules: StatutoryRules; ruleEffectiveFrom: string; exceptions: RunException[]; builtAt: string }
type SlipResult = SalaryResult & { meta: { month: string; lopDaysX2: number; outsideEmploymentDaysX2: number; reimbursementClaimIds: string[]; compensationId: string } };

function snapshotOf(run: { rulesSnapshot: unknown }): RunSnapshot { return run.rulesSnapshot as RunSnapshot; }

/** Build (or rebuild) a draft run. Statutory rules must exist or this throws before anything is written. */
async function buildDraft(month: string, actorEmail: string) {
  const { row: ruleRow, rules } = await rulesForMonth(month);
  const [existing] = await db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.month, month)).limit(1);
  if (existing && existing.status !== "draft") throw new HttpError(409, "This month is locked and cannot be rebuilt");

  const mStart = monthStart(month), mEnd = monthEnd(month), calendarDays = monthDays(month);
  const allEmps = await db.select().from(schema.employees);
  const stateOf = new Map((await db.select({ id: schema.locations.id, state: schema.locations.state }).from(schema.locations)).map((l) => [l.id, l.state]));
  const emps = allEmps.filter((e) => e.joiningDate <= mEnd && (e.status !== "exited" || (e.lastWorkingDay != null && e.lastWorkingDay >= mStart)));
  const ids = emps.map((e) => e.id);

  const exceptions: RunException[] = [];
  const slips: { employeeId: string; paidDaysX2: number; result: SlipResult }[] = [];

  if (ids.length) {
    const comps = await db.select().from(schema.compensation).where(and(inArray(schema.compensation.employeeId, ids), lte(schema.compensation.effectiveFrom, mEnd)));
    const compBy = new Map<string, typeof comps[number]>();
    for (const c of comps) {
      const cur = compBy.get(c.employeeId);
      if (!cur || c.effectiveFrom > cur.effectiveFrom || (c.effectiveFrom === cur.effectiveFrom && c.createdAt > cur.createdAt)) compBy.set(c.employeeId, c);
    }
    const leaves = await db.select({ l: schema.leaveRequests }).from(schema.leaveRequests)
      .innerJoin(schema.leaveTypes, eq(schema.leaveRequests.leaveTypeId, schema.leaveTypes.id))
      .where(and(inArray(schema.leaveRequests.employeeId, ids), eq(schema.leaveRequests.status, "approved"), eq(schema.leaveTypes.paid, false), lte(schema.leaveRequests.fromDate, mEnd), gte(schema.leaveRequests.toDate, mStart)));
    const claims = await db.select().from(schema.reimbClaims).where(and(inArray(schema.reimbClaims.employeeId, ids), eq(schema.reimbClaims.status, "approved"), lte(schema.reimbClaims.month, month)));
    const [calRow] = await db.select().from(schema.workCalendar).orderBy(desc(schema.workCalendar.id)).limit(1);
    const cal = normaliseCalendar(calRow?.settings);
    const hols = await db.select().from(schema.holidays).where(and(gte(schema.holidays.date, mStart), lte(schema.holidays.date, mEnd)));
    const holidays = hols.map((h) => ({ date: h.date, optional: h.optional ?? false }));
    const prior = await db.select({ employeeId: schema.payslips.employeeId, result: schema.payslips.result }).from(schema.payslips)
      .innerJoin(schema.payrollRuns, eq(schema.payslips.runId, schema.payrollRuns.id))
      .where(and(inArray(schema.payslips.employeeId, ids), inArray(schema.payrollRuns.status, ["locked", "paid"]), gte(schema.payrollRuns.month, fyStartMonth(month)), lt(schema.payrollRuns.month, month)));
    const priorBy = new Map<string, unknown[]>();
    for (const p of prior) priorBy.set(p.employeeId, [...(priorBy.get(p.employeeId) ?? []), p.result]);

    for (const e of emps) {
      const fail = (message: string) => exceptions.push({ employeeId: e.id, code: e.code, name: e.fullName, message });
      try {
        const comp = compBy.get(e.id);
        if (!comp) { fail("No compensation effective for this month"); continue; }
        const win = employmentWindow(month, e.joiningDate, e.lastWorkingDay);
        const outside = employmentGapX2(month, win);
        const lop = lossOfPayX2(leaves.filter((x) => x.l.employeeId === e.id).map((x) => ({ fromDate: x.l.fromDate, toDate: x.l.toDate, halfDay: x.l.halfDay, days2: x.l.days2 })), win, cal, holidays);
        const payableX2 = paidDaysX2(calendarDays, lop + outside);
        const myClaims = claims.filter((c) => c.employeeId === e.id);
        const reimb = myClaims.reduce((s, c) => s + c.amountPaise, 0);
        const result = computeSalary({
          monthlyGrossPaise: comp.monthlyGrossPaise, components: comp.components as ComponentDef[], reimbursementsPaise: reimb,
          calendarDays, paidDays: payableX2 / 2, rules, pt: { state: e.locationId ? stateOf.get(e.locationId) ?? null : null, gender: e.gender, month },
          tds: { taxDeductedSoFarPaise: sumTdsYtd(priorBy.get(e.id) ?? []), taxableSoFarPaise: sumGrossYtd(priorBy.get(e.id) ?? []), monthsRemaining: monthsRemainingInFy(month) },
        });
        slips.push({ employeeId: e.id, paidDaysX2: payableX2, result: { ...result, meta: { month, lopDaysX2: lop, outsideEmploymentDaysX2: outside, reimbursementClaimIds: myClaims.map((c) => c.id), compensationId: comp.id } } });
      } catch (err) { fail((err as Error).message); }
    }
  }

  const snapshot: RunSnapshot = { rules, ruleEffectiveFrom: ruleRow.effectiveFrom, exceptions, builtAt: new Date().toISOString() };
  const runId = await db.transaction(async (tx) => {
    let id: string;
    if (existing) {
      const upd = await tx.update(schema.payrollRuns).set({ rulesSnapshot: snapshot }).where(and(eq(schema.payrollRuns.id, existing.id), eq(schema.payrollRuns.status, "draft"))).returning({ id: schema.payrollRuns.id });
      if (!upd.length) throw new HttpError(409, "This month was locked while rebuilding");
      id = existing.id;
      await tx.delete(schema.payslips).where(eq(schema.payslips.runId, id));
    } else {
      const [ins] = await tx.insert(schema.payrollRuns).values({ month, status: "draft", rulesSnapshot: snapshot, createdBy: actorEmail }).returning({ id: schema.payrollRuns.id });
      id = ins.id;
    }
    if (slips.length) {
      await tx.insert(schema.payslips).values(slips.map((s) => ({ runId: id, employeeId: s.employeeId, paidDays: s.paidDaysX2, calendarDays, result: s.result, netPayPaise: s.result.netPayPaise })));
    }
    return id;
  });
  return { runId, rebuilt: !!existing, exceptions, totals: totalsOf(slips.map((s) => s.result)) };
}

async function runDetail(id: string) {
  const [run] = await db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.id, id)).limit(1);
  if (!run) throw new HttpError(404, "Payroll run not found");
  const slips = await db.select({ s: schema.payslips, code: schema.employees.code, name: schema.employees.fullName }).from(schema.payslips)
    .innerJoin(schema.employees, eq(schema.payslips.employeeId, schema.employees.id)).where(eq(schema.payslips.runId, id)).orderBy(asc(schema.employees.fullName));
  return { run, slips };
}

r.post("/payroll/runs", wrap(async (req, res) => {
  if (!canRunPayroll(req)) deny();
  const { month } = parse(z.object({ month: z.string().regex(MONTH_RE) }), req.body);
  const out = await buildDraft(month, actorOf(req).email);
  await logAudit(actorOf(req).email, out.rebuilt ? "payroll.run.rebuild" : "payroll.run.create", "payroll_run", out.runId, { month, headcount: out.totals.headcount, exceptions: out.exceptions.length });
  res.status(out.rebuilt ? 200 : 201).json(out);
}));

r.post("/payroll/runs/:id/recompute", wrap(async (req, res) => {
  if (!canRunPayroll(req)) deny();
  const [run] = await db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.id, idParam(req))).limit(1);
  if (!run) throw new HttpError(404, "Payroll run not found");
  if (run.status !== "draft") throw new HttpError(409, "Locked runs are immutable");
  const out = await buildDraft(run.month, actorOf(req).email);
  await logAudit(actorOf(req).email, "payroll.run.rebuild", "payroll_run", run.id, { month: run.month });
  res.json(out);
}));

r.get("/payroll/runs", wrap(async (req, res) => {
  if (!canViewPayroll(req)) deny();
  const runs = await db.select().from(schema.payrollRuns).orderBy(desc(schema.payrollRuns.month));
  const agg = await db.select({ runId: schema.payslips.runId, n: sql<number>`count(*)::int`, net: sql<number>`coalesce(sum(${schema.payslips.netPayPaise}),0)::bigint` }).from(schema.payslips).groupBy(schema.payslips.runId);
  const by = new Map(agg.map((a) => [a.runId, a]));
  res.json(runs.map((x) => ({ id: x.id, month: x.month, status: x.status, lockedAt: x.lockedAt, lockedBy: x.lockedBy, createdAt: x.createdAt, headcount: by.get(x.id)?.n ?? 0, netPayPaise: Number(by.get(x.id)?.net ?? 0), exceptionCount: snapshotOf(x).exceptions?.length ?? 0 })));
}));

r.get("/payroll/runs/:id", wrap(async (req, res) => {
  if (!canViewPayroll(req)) deny();
  const { run, slips } = await runDetail(idParam(req));
  const snap = snapshotOf(run);
  res.json({
    id: run.id, month: run.month, status: run.status, lockedBy: run.lockedBy, lockedAt: run.lockedAt, createdBy: run.createdBy, createdAt: run.createdAt,
    rules: snap.rules, ruleEffectiveFrom: snap.ruleEffectiveFrom, builtAt: snap.builtAt,
    totals: totalsOf(slips.map((x) => x.s.result as SalaryResult)), exceptions: snap.exceptions ?? [],
    payslips: slips.map((x) => ({ id: x.s.id, employeeId: x.s.employeeId, code: x.code, name: x.name, paidDays: x.s.paidDays / 2, calendarDays: x.s.calendarDays, netPayPaise: x.s.netPayPaise, result: x.s.result })),
  });
}));

r.post("/payroll/runs/:id/lock", wrap(async (req, res) => {
  if (!canRunPayroll(req)) deny();
  const id = idParam(req);
  const { acknowledgeExceptions } = parse(z.object({ acknowledgeExceptions: z.boolean().optional() }), req.body ?? {});
  const a = actorOf(req);
  const out = await db.transaction(async (tx) => {
    const [run] = await tx.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.id, id)).for("update");
    if (!run) throw new HttpError(404, "Payroll run not found");
    if (run.status !== "draft") throw new HttpError(409, "Run is already locked");
    const slips = await tx.select().from(schema.payslips).where(eq(schema.payslips.runId, id));
    if (!slips.length) throw new HttpError(400, "Run has no payslips");
    const exc = snapshotOf(run).exceptions ?? [];
    if (exc.length && !acknowledgeExceptions) throw new HttpError(409, `Run has ${exc.length} exception(s); review them and lock with acknowledgeExceptions: true`);
    const claimIds = [...new Set(slips.flatMap((s) => (s.result as SlipResult).meta?.reimbursementClaimIds ?? []))];
    if (claimIds.length) {
      const paid = await tx.update(schema.reimbClaims).set({ status: "paid", paidInRunId: id })
        .where(and(inArray(schema.reimbClaims.id, claimIds), eq(schema.reimbClaims.status, "approved"))).returning({ id: schema.reimbClaims.id });
      if (paid.length !== claimIds.length) throw new HttpError(409, "Some reimbursement claims changed since the draft was built; recompute the run");
    }
    await tx.update(schema.payrollRuns).set({ status: "locked", lockedBy: a.email, lockedAt: new Date() }).where(eq(schema.payrollRuns.id, id));
    return { month: run.month, payslips: slips.length, claimsPaid: claimIds.length };
  });
  await logAudit(a.email, "payroll.run.lock", "payroll_run", id, out);
  res.json({ ok: true, ...out });
}));

// ============================================================ payslips
async function loadSlip(req: Request) {
  const id = idParam(req);
  const a = actorOf(req);
  const [row] = await db.select({ s: schema.payslips, run: schema.payrollRuns }).from(schema.payslips).innerJoin(schema.payrollRuns, eq(schema.payslips.runId, schema.payrollRuns.id)).where(eq(schema.payslips.id, id)).limit(1);
  if (!row) throw new HttpError(404, "Payslip not found");
  if (!canAccess(scopeFor(a.roles, "comp.read"), a, row.s.employeeId)) throw new HttpError(404, "Payslip not found");
  if (row.run.status === "draft" && !canViewPayroll(req)) throw new HttpError(404, "Payslip not found"); // drafts are not visible to employees
  if (a.employeeId !== row.s.employeeId) await logAudit(a.email, "payslip.read", "payslip", id, { employeeId: row.s.employeeId });
  return row;
}

r.get("/me/payslips", wrap(async (req, res) => {
  const a = actorOf(req);
  if (!a.employeeId) return res.json([]);
  const rows = await db.select({ s: schema.payslips, run: schema.payrollRuns }).from(schema.payslips).innerJoin(schema.payrollRuns, eq(schema.payslips.runId, schema.payrollRuns.id))
    .where(and(eq(schema.payslips.employeeId, a.employeeId), inArray(schema.payrollRuns.status, ["locked", "paid"]))).orderBy(desc(schema.payrollRuns.month));
  res.json(rows.map((x) => ({ id: x.s.id, month: x.run.month, paidDays: x.s.paidDays / 2, calendarDays: x.s.calendarDays, netPayPaise: x.s.netPayPaise })));
}));

r.get("/payslips/:id", wrap(async (req, res) => {
  const { s, run } = await loadSlip(req);
  const [emp] = await db.select({ code: schema.employees.code, name: schema.employees.fullName }).from(schema.employees).where(eq(schema.employees.id, s.employeeId)).limit(1);
  res.json({ id: s.id, month: run.month, runStatus: run.status, employee: emp, paidDays: s.paidDays / 2, calendarDays: s.calendarDays, netPayPaise: s.netPayPaise, result: s.result });
}));

r.get("/payslips/:id/html", wrap(async (req, res) => {
  const { s, run } = await loadSlip(req);
  const [e] = await db.select({ emp: schema.employees, des: schema.designations.name, dep: schema.departments.name }).from(schema.employees)
    .leftJoin(schema.designations, eq(schema.employees.designationId, schema.designations.id)).leftJoin(schema.departments, eq(schema.employees.departmentId, schema.departments.id))
    .where(eq(schema.employees.id, s.employeeId)).limit(1);
  if (!e) throw new HttpError(404, "Employee not found");
  const safeDecrypt = (v: string | null) => { if (!v) return null; try { return maskAccount(decryptField(v)); } catch { return null; } };
  const html = renderPayslipHtml({
    company: COMPANY, month: run.month,
    employee: { name: e.emp.fullName, code: e.emp.code, designation: e.des, department: e.dep, joiningDate: e.emp.joiningDate, panMasked: safeDecrypt(e.emp.panEnc), bankName: e.emp.bankName, accountMasked: safeDecrypt(e.emp.accountEnc) },
    paidDaysX2: s.paidDays, calendarDays: s.calendarDays, result: s.result as SalaryResult,
  });
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'");
  res.type("html").send(html);
}));

// ============================================================ signatories
const signatoryPublic = (x: typeof schema.signatories.$inferSelect) => ({ id: x.id, email: x.email, displayName: x.displayName, designation: x.designation, hasSignature: !!x.signatureFileId, hasStamp: !!x.stampFileId });

r.get("/signatories", wrap(async (req, res) => {
  const a = actorOf(req);
  if (canRunPayroll(req)) return res.json((await db.select().from(schema.signatories).orderBy(asc(schema.signatories.displayName))).map(signatoryPublic));
  if (scopeFor(a.roles, "sign.documents") === "own") {
    const [me] = await db.select().from(schema.signatories).where(eq(schema.signatories.email, a.email)).limit(1);
    return res.json(me ? [signatoryPublic(me)] : []);
  }
  deny();
}));

r.put("/signatories", wrap(async (req, res) => {
  const a = actorOf(req);
  const b = parse(z.object({ email: z.string().email().max(200).optional(), displayName: z.string().trim().min(1).max(100), designation: z.string().trim().min(1).max(100) }), req.body);
  if (canRunPayroll(req)) {
    if (!b.email) throw new HttpError(400, "email is required");
    const email = b.email.toLowerCase();
    const [row] = await db.insert(schema.signatories).values({ email, displayName: b.displayName, designation: b.designation })
      .onConflictDoUpdate({ target: schema.signatories.email, set: { displayName: b.displayName, designation: b.designation } }).returning();
    await logAudit(a.email, "signatory.upsert", "signatory", row.id, { email });
    return res.json(signatoryPublic(row));
  }
  if (scopeFor(a.roles, "sign.documents") !== "own") deny();
  if (b.email && b.email.toLowerCase() !== a.email) throw new HttpError(403, "You can only edit your own signatory record");
  const [row] = await db.update(schema.signatories).set({ displayName: b.displayName, designation: b.designation }).where(eq(schema.signatories.email, a.email)).returning();
  if (!row) throw new HttpError(404, "No signatory record exists for you; ask an HR admin to create it");
  await logAudit(a.email, "signatory.update", "signatory", row.id);
  res.json(signatoryPublic(row));
}));

function sniffImage(buf: Buffer, mime: string): boolean {
  if (mime === "image/png") return buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

r.post("/signatories/me/assets", wrap(async (req, res) => {
  const a = actorOf(req);
  if (scopeFor(a.roles, "sign.documents") !== "own") deny();
  const b = parse(z.object({ kind: z.enum(["stamp", "signature"]), name: z.string().trim().min(1).max(120), mime: z.enum(["image/png", "image/jpeg"]), dataBase64: z.string().min(16).max(14_000_000) }), req.body);
  const [me] = await db.select().from(schema.signatories).where(eq(schema.signatories.email, a.email)).limit(1);
  if (!me) throw new HttpError(404, "No signatory record exists for you; ask an HR admin to create it");
  const buf = Buffer.from(b.dataBase64.replace(/^data:[^,]+,/, ""), "base64");
  if (!sniffImage(buf, b.mime)) throw new HttpError(400, "File content does not match the declared image type");
  let file;
  try { file = await saveFile({ kind: b.kind, buf, name: b.name, mime: b.mime, uploadedBy: a.email, ownerEmployeeId: a.employeeId ?? undefined }); } catch (e) { throw new HttpError(400, (e as Error).message); }
  await db.update(schema.signatories).set(b.kind === "signature" ? { signatureFileId: file.id } : { stampFileId: file.id }).where(eq(schema.signatories.id, me.id));
  await logAudit(a.email, "signatory.asset", "signatory", me.id, { kind: b.kind, fileId: file.id });
  res.status(201).json({ fileId: file.id, kind: b.kind });
}));

// ============================================================ bank advice
type RunRow = typeof schema.payrollRuns.$inferSelect;

/** Rebuild the advice from live payslip + employee data. Full account numbers exist only in memory here. */
async function liveAdvice(run: RunRow, refNo: string) {
  const rows = await db.select({ s: schema.payslips, e: schema.employees }).from(schema.payslips).innerJoin(schema.employees, eq(schema.payslips.employeeId, schema.employees.id)).where(eq(schema.payslips.runId, run.id));
  rows.sort((x, y) => x.e.fullName.localeCompare(y.e.fullName) || x.e.code.localeCompare(y.e.code));
  const skipped: { code: string; name: string; reason: string }[] = [];
  const used: typeof rows = [];
  for (const x of rows) {
    if (x.s.netPayPaise <= 0) skipped.push({ code: x.e.code, name: x.e.fullName, reason: "Net pay is zero" }); else used.push(x);
  }
  const inputs = used.map((x) => {
    let accountNo = "";
    try { if (x.e.accountEnc) accountNo = decryptField(x.e.accountEnc).replace(/\s+/g, ""); } catch { /* invalid stays empty and fails validation */ }
    return { name: x.e.fullName, bankName: x.e.bankName ?? "", accountNo, ifsc: (x.e.ifsc ?? "").toUpperCase().trim(), amountPaise: x.s.netPayPaise };
  });
  const built = buildAdvice({ month: run.month, refNo, rows: inputs });
  return { built, skipped, used };
}

async function loadAdvice(req: Request) {
  if (!canViewPayroll(req)) deny();
  const [adv] = await db.select().from(schema.bankAdvices).where(eq(schema.bankAdvices.id, idParam(req))).limit(1);
  if (!adv) throw new HttpError(404, "Bank advice not found");
  const [run] = await db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.id, adv.runId)).limit(1);
  if (!run) throw new HttpError(404, "Payroll run not found");
  return { adv, run };
}
/** Full rows if the live data still hashes to what was stored; otherwise null. */
async function verifiedRows(adv: typeof schema.bankAdvices.$inferSelect, run: RunRow): Promise<AdviceRow[] | null> {
  const { built } = await liveAdvice(run, adv.refNo);
  return built.ok && safeEqualHex(built.contentHash, adv.contentHash) ? built.rows : null;
}
const CHANGED = "Payroll or bank details changed since this advice was generated. Generate a new advice.";

const advicePublic = (adv: typeof schema.bankAdvices.$inferSelect) => ({
  id: adv.id, runId: adv.runId, refNo: adv.refNo, totalPaise: adv.totalPaise, rowCount: adv.rowCount, contentHash: adv.contentHash,
  signedBy: adv.signedBy, signedAt: adv.signedAt, createdBy: adv.createdBy, createdAt: adv.createdAt,
});

r.post("/payroll/runs/:id/bank-advice", wrap(async (req, res) => {
  if (!canViewPayroll(req)) deny();
  const [run] = await db.select().from(schema.payrollRuns).where(eq(schema.payrollRuns.id, idParam(req))).limit(1);
  if (!run) throw new HttpError(404, "Payroll run not found");
  if (run.status === "draft") throw new HttpError(409, "Lock the payroll run before generating a bank advice");
  if ((run.rulesSnapshot as { imported?: boolean } | null)?.imported === true) throw new HttpError(409, "This month was imported as already paid, so it has no bank advice");
  const existing = await db.select().from(schema.bankAdvices).where(eq(schema.bankAdvices.runId, run.id));
  if (existing.some((x) => x.signedAt)) throw new HttpError(409, "A signed bank advice already exists for this run");
  const allRefs = await db.select({ ref: schema.bankAdvices.refNo }).from(schema.bankAdvices).where(sql`${schema.bankAdvices.refNo} like ${"BA/" + run.month + "/%"}`);
  const refNo = nextAdviceRef(run.month, allRefs.map((x) => x.ref));
  const { built, skipped, used } = await liveAdvice(run, refNo);
  if (!built.ok) {
    return res.status(400).json({ error: "Some employees have invalid bank details", rows: built.errors.map((e) => ({ employeeCode: used[e.row - 1]?.e.code, name: used[e.row - 1]?.e.fullName, errors: e.errors })), skipped });
  }
  if (!built.rows.length) throw new HttpError(400, "No payable rows");
  const [adv] = await db.insert(schema.bankAdvices).values({
    runId: run.id, refNo, totalPaise: built.totalPaise, rowCount: built.rows.length, contentHash: built.contentHash, rows: maskedRows(built.rows), createdBy: actorOf(req).email,
  }).returning();
  await logAudit(actorOf(req).email, "bank_advice.create", "bank_advice", adv.id, { refNo, totalPaise: built.totalPaise, rows: built.rows.length });
  res.status(201).json({ ...advicePublic(adv), rows: adv.rows, skipped, totalFormatted: built.totalFormatted, totalWords: built.totalWords });
}));

r.get("/bank-advices", wrap(async (req, res) => {
  if (!canViewPayroll(req)) deny();
  const q = parse(z.object({ runId: uuid.optional() }), req.query);
  const rows = q.runId ? await db.select().from(schema.bankAdvices).where(eq(schema.bankAdvices.runId, q.runId)) : await db.select().from(schema.bankAdvices).orderBy(desc(schema.bankAdvices.createdAt)).limit(100);
  res.json(rows.map(advicePublic));
}));

r.get("/bank-advices/:id", wrap(async (req, res) => {
  const { adv, run } = await loadAdvice(req);
  const intact = !!(await verifiedRows(adv, run));
  res.json({ ...advicePublic(adv), month: run.month, rows: adv.rows, integrity: intact ? "ok" : "changed" });
}));

async function dataUri(fileId: string | null): Promise<string | null> {
  if (!fileId) return null;
  const [f] = await db.select().from(schema.files).where(eq(schema.files.id, fileId)).limit(1);
  if (!f || (f.mime !== "image/png" && f.mime !== "image/jpeg")) return null;
  return `data:${f.mime};base64,${(await readFileBytes(f.storageKey)).toString("base64")}`;
}

r.get("/bank-advices/:id/html", wrap(async (req, res) => {
  const { adv, run } = await loadAdvice(req);
  const rows = await verifiedRows(adv, run);
  if (!rows) throw new HttpError(409, CHANGED);
  const q = parse(z.object({
    bank: z.string().max(120).optional(), branch: z.string().max(160).optional(), city: z.string().max(120).optional(),
    debitAccount: z.string().max(40).optional(), date: isoDate.optional(),
  }), req.query);
  let signed: Parameters<typeof renderAdviceHtml>[0]["signed"] = null;
  if (adv.signedBy && adv.signedAt) {
    const [sg] = await db.select().from(schema.signatories).where(eq(schema.signatories.email, adv.signedBy)).limit(1);
    signed = { name: sg?.displayName ?? adv.signedBy, designation: sg?.designation ?? "", at: adv.signedAt.toISOString(), signatureUri: await dataUri(sg?.signatureFileId ?? null), stampUri: await dataUri(sg?.stampFileId ?? null) };
  }
  await logAudit(actorOf(req).email, "bank_advice.view_full", "bank_advice", adv.id);
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'unsafe-inline'");
  res.type("html").send(renderAdviceHtml({
    company: COMPANY, refNo: adv.refNo, month: run.month, date: q.date ?? todayIst(),
    to: { bank: q.bank ?? "[Bank name]", branch: q.branch ?? "[Branch]", city: q.city ?? "[City]", debitAccount: q.debitAccount ?? "[Company account number]" }, rows, totalPaise: adv.totalPaise, signed,
  }));
}));

r.get("/bank-advices/:id/csv", wrap(async (req, res) => {
  const { adv, run } = await loadAdvice(req);
  const rows = await verifiedRows(adv, run);
  if (!rows) throw new HttpError(409, CHANGED);
  await logAudit(actorOf(req).email, "bank_advice.export_csv", "bank_advice", adv.id);
  res.setHeader("Content-Disposition", `attachment; filename="${safeFileName(adv.refNo)}.csv"`);
  res.type("text/csv").send(toCsv(rows));
}));

r.post("/bank-advices/:id/sign", wrap(async (req, res) => {
  const a = actorOf(req);
  if (scopeFor(a.roles, "sign.documents") !== "own") deny();
  const { adv, run } = await loadAdvice(req);
  if (adv.signedAt) throw new HttpError(409, "Already signed");
  if (run.status === "draft") throw new HttpError(409, "Payroll run is not locked");
  const [me] = await db.select().from(schema.signatories).where(eq(schema.signatories.email, a.email)).limit(1);
  if (!me) throw new HttpError(403, "You are not a registered signatory");
  if (!me.signatureFileId) throw new HttpError(400, "Upload your signature before signing");
  const rows = await verifiedRows(adv, run);
  if (!rows) throw new HttpError(409, CHANGED);
  const upd = await db.update(schema.bankAdvices).set({ signedBy: a.email, signedAt: new Date() }).where(and(eq(schema.bankAdvices.id, adv.id), sql`${schema.bankAdvices.signedAt} is null`)).returning();
  if (!upd.length) throw new HttpError(409, "Already signed");
  await logAudit(a.email, "bank_advice.sign", "bank_advice", adv.id, { refNo: adv.refNo, contentHash: adv.contentHash, totalPaise: adv.totalPaise });
  res.json(advicePublic(upd[0]));
}));

export default r;
