import { Router, type Request } from "express";
import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { db, schema } from "../db";
import { wrap, parse, HttpError } from "./util";
import { logAudit } from "../lib/audit";
import { need, idParam, selfId, istDate, dateStr, monthStr, monthRange, addDays, parseOut } from "../lib/routeHelpers";
import { withinGeofence } from "../../shared/hr/geo";
import { isWorkingDay, leaveDaysX2, entitlementX2, balanceX2, type CalendarSettings } from "../../shared/hr/leave";
import { canAccess, scopeFor } from "../../shared/hr/access";

const r = Router();
const A = schema;

// ---------- calendar ----------
const DEFAULT_CAL: CalendarSettings = { weeklyOff: [0], saturdays: { mode: "alternate", offWeeks: [2, 4] }, workStart: "09:30", workEnd: "18:30" };
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const calendarSchema = z.object({
  weeklyOff: z.array(z.number().int().min(0).max(6)).max(7),
  saturdays: z.object({ mode: z.enum(["all_working", "all_off", "alternate"]), offWeeks: z.array(z.number().int().min(1).max(5)).max(5).optional() }),
  workStart: hhmm, workEnd: hhmm,
}).refine((c) => c.workStart < c.workEnd, "workEnd must be after workStart");

async function getCalendar(): Promise<CalendarSettings> {
  const [row] = await db.select().from(A.workCalendar).orderBy(desc(A.workCalendar.id)).limit(1);
  return row ? (row.settings as CalendarSettings) : DEFAULT_CAL;
}
async function holidaysBetween(from: string, to: string) {
  const rows = await db.select().from(A.holidays).where(and(gte(A.holidays.date, from), lte(A.holidays.date, to)));
  return rows.map((h) => ({ date: h.date, name: h.name, optional: !!h.optional }));
}

r.get("/calendar", wrap(async (_req, res) => { res.json(await getCalendar()); }));
r.put("/calendar", wrap(async (req, res) => {
  need(req, "calendar.configure", "all");
  const b = parse(calendarSchema, req.body);
  await db.insert(A.workCalendar).values({ settings: b, updatedBy: req.actor!.email });
  await logAudit(req.actor!.email, "calendar.update", "calendar", undefined, b);
  res.json(b);
}));

const holidayBody = z.object({ date: dateStr, name: z.string().trim().min(1).max(100), optional: z.boolean().optional() });
r.get("/holidays", wrap(async (req, res) => {
  const q = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() }).parse(req.query);
  const y = q.year ?? Number(istDate().slice(0, 4));
  res.json(await db.select().from(A.holidays).where(and(gte(A.holidays.date, `${y}-01-01`), lte(A.holidays.date, `${y}-12-31`))).orderBy(asc(A.holidays.date)));
}));
r.post("/holidays", wrap(async (req, res) => {
  need(req, "calendar.configure", "all");
  const b = parse(holidayBody, req.body);
  const [row] = await db.insert(A.holidays).values(b).onConflictDoNothing().returning();
  if (!row) throw new HttpError(409, "A holiday already exists on that date");
  await logAudit(req.actor!.email, "holiday.create", "holiday", row.id, { date: b.date });
  res.status(201).json(row);
}));
r.put("/holidays/:id", wrap(async (req, res) => {
  need(req, "calendar.configure", "all");
  const b = parse(holidayBody, req.body);
  const [row] = await db.update(A.holidays).set(b).where(eq(A.holidays.id, idParam(req))).returning();
  if (!row) throw new HttpError(404, "Not found");
  await logAudit(req.actor!.email, "holiday.update", "holiday", row.id);
  res.json(row);
}));
r.delete("/holidays/:id", wrap(async (req, res) => {
  need(req, "calendar.configure", "all");
  const id = idParam(req);
  await db.delete(A.holidays).where(eq(A.holidays.id, id));
  await logAudit(req.actor!.email, "holiday.delete", "holiday", id);
  res.json({ ok: true });
}));

// ---------- attendance ----------
const punchBody = z.object({ kind: z.enum(["in", "out"]), lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional() });

r.post("/attendance/punch", wrap(async (req, res) => {
  const empId = selfId(req);
  const b = parse(punchBody, req.body);
  const [emp] = await db.select().from(A.employees).where(eq(A.employees.id, empId)).limit(1);
  if (!emp || emp.status === "exited") throw new HttpError(403, "Not allowed");
  const workDate = istDate();
  const [last] = await db.select().from(A.attendancePunches).where(and(eq(A.attendancePunches.employeeId, empId), eq(A.attendancePunches.workDate, workDate))).orderBy(desc(A.attendancePunches.at)).limit(1);
  if (last && last.kind === b.kind) throw new HttpError(409, `You have already punched ${b.kind}. Punch ${b.kind === "in" ? "out" : "in"} next.`);
  let within: boolean | null = null;
  if (emp.locationId) {
    const [loc] = await db.select().from(A.locations).where(eq(A.locations.id, emp.locationId)).limit(1);
    if (loc) within = withinGeofence({ lat: b.lat, lng: b.lng }, loc); // coordinates are used here only and never stored or logged
  }
  const [row] = await db.insert(A.attendancePunches).values({ employeeId: empId, kind: b.kind, workDate, withinOffice: within }).returning();
  res.status(201).json({ kind: row.kind, at: row.at, workDate, withinOffice: row.withinOffice });
}));

type PunchRow = typeof A.attendancePunches.$inferSelect;
function summariseDay(ps: PunchRow[]) {
  const sorted = [...ps].sort((a, b) => a.at.getTime() - b.at.getTime());
  const firstIn = sorted.find((p) => p.kind === "in");
  const lastOut = [...sorted].reverse().find((p) => p.kind === "out");
  let ms = 0, open: Date | null = null;
  for (const p of sorted) { if (p.kind === "in") open = open ?? p.at; else if (open) { ms += p.at.getTime() - open.getTime(); open = null; } }
  return { firstIn: firstIn?.at ?? null, lastOut: lastOut?.at ?? null, withinOffice: firstIn?.withinOffice ?? null, workedMinutes: Math.round(ms / 60000) };
}

r.get("/me/attendance", wrap(async (req, res) => {
  const empId = selfId(req);
  const q = z.object({ month: monthStr.optional() }).parse(req.query);
  const month = q.month ?? istDate().slice(0, 7);
  const { from, to } = monthRange(month);
  const punches = await db.select().from(A.attendancePunches).where(and(eq(A.attendancePunches.employeeId, empId), gte(A.attendancePunches.workDate, from), lte(A.attendancePunches.workDate, to))).orderBy(asc(A.attendancePunches.at));
  const cal = await getCalendar();
  const hols = await holidaysBetween(from, to);
  const leaves = await db.select().from(A.leaveRequests).where(and(eq(A.leaveRequests.employeeId, empId), eq(A.leaveRequests.status, "approved"), lte(A.leaveRequests.fromDate, to), gte(A.leaveRequests.toDate, from)));
  const days: unknown[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const ps = punches.filter((p) => p.workDate === d);
    const onLeave = leaves.some((l) => l.fromDate <= d && l.toDate >= d);
    const hol = hols.find((h) => h.date === d && !h.optional);
    days.push({ date: d, working: isWorkingDay(d, cal, hols), holiday: hol?.name ?? null, onLeave, ...summariseDay(ps), punches: ps.map((p) => ({ kind: p.kind, at: p.at, withinOffice: p.withinOffice })) });
  }
  res.json({ month, workStart: cal.workStart, workEnd: cal.workEnd, days });
}));

r.get("/attendance", wrap(async (req, res) => {
  const scope = need(req, "attendance.read");
  const q = z.object({ date: dateStr.optional(), month: monthStr.optional() }).parse(req.query);
  if (!!q.date === !!q.month) throw new HttpError(400, "Provide exactly one of date or month");
  const actor = req.actor!;
  let emps = await db.select({ id: A.employees.id, code: A.employees.code, fullName: A.employees.fullName, status: A.employees.status }).from(A.employees).where(ne(A.employees.status, "exited"));
  emps = emps.filter((e) => canAccess(scope, actor, e.id));
  if (!emps.length) return res.json({ rows: [] });
  const ids = emps.map((e) => e.id);
  const { from, to } = q.date ? { from: q.date, to: q.date } : monthRange(q.month!);
  const punches = await db.select().from(A.attendancePunches).where(and(inArray(A.attendancePunches.employeeId, ids), gte(A.attendancePunches.workDate, from), lte(A.attendancePunches.workDate, to)));
  const leaves = await db.select().from(A.leaveRequests).where(and(inArray(A.leaveRequests.employeeId, ids), eq(A.leaveRequests.status, "approved"), lte(A.leaveRequests.fromDate, to), gte(A.leaveRequests.toDate, from)));
  const cal = await getCalendar();
  const hols = await holidaysBetween(from, to);
  const today = istDate();
  const rows = emps.map((e) => {
    const mine = punches.filter((p) => p.employeeId === e.id);
    if (q.date) {
      const s = summariseDay(mine);
      const working = isWorkingDay(q.date, cal, hols);
      const onLeave = leaves.some((l) => l.employeeId === e.id);
      const status = !working ? "off" : s.firstIn ? "present" : onLeave ? "leave" : q.date <= today ? "absent" : "upcoming";
      return { employeeId: e.id, code: e.code, name: e.fullName, status, ...s };
    }
    let present = 0, leaveDays = 0, absent = 0, workingDays = 0;
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (!isWorkingDay(d, cal, hols)) continue;
      workingDays++;
      if (mine.some((p) => p.workDate === d)) present++;
      else if (leaves.some((l) => l.employeeId === e.id && l.fromDate <= d && l.toDate >= d)) leaveDays++;
      else if (d <= today) absent++;
    }
    return { employeeId: e.id, code: e.code, name: e.fullName, workingDays, present, leave: leaveDays, absent };
  });
  res.json({ date: q.date ?? null, month: q.month ?? null, rows });
}));

// ---------- leave types ----------
const leaveTypeBody = z.object({
  key: z.string().trim().regex(/^[a-z][a-z0-9_]{1,30}$/), name: z.string().trim().min(1).max(60),
  annualQuotaHalfDays: z.number().int().min(0).max(730), carryForwardHalfDays: z.number().int().min(0).max(730).default(0),
  paid: z.boolean().default(true), accrual: z.enum(["upfront", "monthly"]).default("monthly"),
  requiresNote: z.boolean().default(false), active: z.boolean().default(true),
});
r.get("/leave/types", wrap(async (_req, res) => { res.json(await db.select().from(A.leaveTypes).where(eq(A.leaveTypes.active, true)).orderBy(asc(A.leaveTypes.name))); }));
r.get("/leave/types/all", wrap(async (req, res) => { need(req, "calendar.configure", "all"); res.json(await db.select().from(A.leaveTypes).orderBy(asc(A.leaveTypes.name))); }));
r.post("/leave/types", wrap(async (req, res) => {
  need(req, "calendar.configure", "all");
  const b = parseOut(leaveTypeBody, req.body);
  const [row] = await db.insert(A.leaveTypes).values(b).onConflictDoNothing().returning();
  if (!row) throw new HttpError(409, "A leave type with that key exists");
  await logAudit(req.actor!.email, "leave_type.create", "leave_type", row.id, b);
  res.status(201).json(row);
}));
r.put("/leave/types/:id", wrap(async (req, res) => {
  need(req, "calendar.configure", "all");
  const b = parseOut(leaveTypeBody.omit({ key: true }), req.body);
  const [row] = await db.update(A.leaveTypes).set(b).where(eq(A.leaveTypes.id, idParam(req))).returning();
  if (!row) throw new HttpError(404, "Not found");
  await logAudit(req.actor!.email, "leave_type.update", "leave_type", row.id, b);
  res.json(row);
}));
r.delete("/leave/types/:id", wrap(async (req, res) => {
  need(req, "calendar.configure", "all");
  const id = idParam(req);
  const [used] = await db.select({ id: A.leaveRequests.id }).from(A.leaveRequests).where(eq(A.leaveRequests.leaveTypeId, id)).limit(1);
  if (used) { await db.update(A.leaveTypes).set({ active: false }).where(eq(A.leaveTypes.id, id)); await logAudit(req.actor!.email, "leave_type.deactivate", "leave_type", id); return res.json({ ok: true, deactivated: true }); }
  await db.delete(A.leaveTypes).where(eq(A.leaveTypes.id, id));
  await logAudit(req.actor!.email, "leave_type.delete", "leave_type", id);
  res.json({ ok: true });
}));

// ---------- leave ----------
async function usage(empId: string, year: number, typeId?: string) {
  const rows = await db.select().from(A.leaveRequests).where(and(eq(A.leaveRequests.employeeId, empId), gte(A.leaveRequests.fromDate, `${year}-01-01`), lte(A.leaveRequests.fromDate, `${year}-12-31`), inArray(A.leaveRequests.status, ["approved", "pending"])));
  const f = typeId ? rows.filter((x) => x.leaveTypeId === typeId) : rows;
  return {
    approved: f.filter((x) => x.status === "approved").reduce((a, x) => a + x.days2, 0),
    pending: f.filter((x) => x.status === "pending").reduce((a, x) => a + x.days2, 0),
  };
}

r.get("/me/leave", wrap(async (req, res) => {
  const empId = selfId(req);
  const [emp] = await db.select().from(A.employees).where(eq(A.employees.id, empId)).limit(1);
  if (!emp) throw new HttpError(404, "Not found");
  const today = istDate(); const year = Number(today.slice(0, 4));
  const types = await db.select().from(A.leaveTypes).where(eq(A.leaveTypes.active, true));
  const balances = [];
  for (const t of types) {
    const u = await usage(empId, year, t.id);
    const entitled = entitlementX2({ annualQuotaHalfDays: t.annualQuotaHalfDays, carryForwardHalfDays: t.carryForwardHalfDays, accrual: t.accrual as "upfront" | "monthly" }, today, emp.joiningDate);
    balances.push({ leaveTypeId: t.id, key: t.key, name: t.name, paid: t.paid, entitledX2: entitled, ...balanceX2(entitled, u.approved, u.pending) });
  }
  const requests = await db.select().from(A.leaveRequests).where(and(eq(A.leaveRequests.employeeId, empId), gte(A.leaveRequests.toDate, `${year}-01-01`))).orderBy(desc(A.leaveRequests.fromDate));
  res.json({ year, balances, requests });
}));

const leaveReqBody = z.object({ leaveTypeId: z.string().uuid(), fromDate: dateStr, toDate: dateStr, halfDay: z.boolean().default(false), reason: z.string().trim().max(500).optional() });
r.post("/leave/requests", wrap(async (req, res) => {
  const empId = selfId(req);
  const b = parseOut(leaveReqBody, req.body);
  const [emp] = await db.select().from(A.employees).where(eq(A.employees.id, empId)).limit(1);
  const [type] = await db.select().from(A.leaveTypes).where(and(eq(A.leaveTypes.id, b.leaveTypeId), eq(A.leaveTypes.active, true))).limit(1);
  if (!emp || !type) throw new HttpError(404, "Leave type not found");
  if (type.requiresNote && !b.reason) throw new HttpError(400, "A reason is required for this leave type");
  if (b.toDate < b.fromDate) throw new HttpError(400, "End date is before start date");
  if (b.fromDate.slice(0, 4) !== b.toDate.slice(0, 4)) throw new HttpError(400, "Split requests that span two calendar years");
  const cal = await getCalendar();
  const hols = await holidaysBetween(b.fromDate, b.toDate);
  let days2: number;
  try { days2 = leaveDaysX2(b.fromDate, b.toDate, b.halfDay, cal, hols); } catch (e) { throw new HttpError(400, (e as Error).message); }
  if (days2 === 0) throw new HttpError(400, "The selected dates have no working days");
  const overlap = await db.select({ id: A.leaveRequests.id }).from(A.leaveRequests).where(and(eq(A.leaveRequests.employeeId, empId), inArray(A.leaveRequests.status, ["pending", "approved"]), lte(A.leaveRequests.fromDate, b.toDate), gte(A.leaveRequests.toDate, b.fromDate))).limit(1);
  if (overlap.length) throw new HttpError(409, "You already have a pending or approved request overlapping these dates");
  if (type.paid) {
    const year = Number(b.fromDate.slice(0, 4));
    const asOf = year === Number(istDate().slice(0, 4)) ? istDate() : `${year}-12-31`;
    const entitled = entitlementX2({ annualQuotaHalfDays: type.annualQuotaHalfDays, carryForwardHalfDays: type.carryForwardHalfDays, accrual: type.accrual as "upfront" | "monthly" }, asOf, emp.joiningDate);
    const u = await usage(empId, year, type.id);
    if (days2 > balanceX2(entitled, u.approved, u.pending).available) throw new HttpError(400, "Insufficient leave balance");
  }
  const [row] = await db.insert(A.leaveRequests).values({ employeeId: empId, leaveTypeId: type.id, fromDate: b.fromDate, toDate: b.toDate, halfDay: b.halfDay, days2, reason: b.reason ?? null }).returning();
  await logAudit(req.actor!.email, "leave.request", "leave_request", row.id, { days2 });
  res.status(201).json(row);
}));

r.post("/leave/requests/:id/cancel", wrap(async (req, res) => {
  const empId = selfId(req);
  const [row] = await db.select().from(A.leaveRequests).where(and(eq(A.leaveRequests.id, idParam(req)), eq(A.leaveRequests.employeeId, empId))).limit(1);
  if (!row) throw new HttpError(404, "Not found");
  const ok = row.status === "pending" || (row.status === "approved" && row.fromDate > istDate());
  if (!ok) throw new HttpError(409, "This request can no longer be cancelled");
  await db.update(A.leaveRequests).set({ status: "cancelled" }).where(eq(A.leaveRequests.id, row.id));
  await logAudit(req.actor!.email, "leave.cancel", "leave_request", row.id);
  res.json({ ok: true });
}));

r.get("/leave/requests", wrap(async (req, res) => {
  const q = z.object({ status: z.enum(["pending", "approved", "rejected", "cancelled"]).optional(), employeeId: z.string().uuid().optional(), from: dateStr.optional(), to: dateStr.optional() }).parse(req.query);
  const actor = req.actor!;
  const scope = need(req, "attendance.read"); // own at minimum; leave.approve widens it
  const approveScope = scopeOrNone(req);
  const eff = approveScope === "all" || scope === "all" ? "all" : approveScope === "reports" ? "reports" : "own";
  const conds = [];
  if (q.status) conds.push(eq(A.leaveRequests.status, q.status));
  if (q.employeeId) conds.push(eq(A.leaveRequests.employeeId, q.employeeId));
  if (q.from) conds.push(gte(A.leaveRequests.toDate, q.from));
  if (q.to) conds.push(lte(A.leaveRequests.fromDate, q.to));
  const rows = await db.select({
    id: A.leaveRequests.id, employeeId: A.leaveRequests.employeeId, code: A.employees.code, employeeName: A.employees.fullName,
    leaveType: A.leaveTypes.name, fromDate: A.leaveRequests.fromDate, toDate: A.leaveRequests.toDate, halfDay: A.leaveRequests.halfDay,
    days2: A.leaveRequests.days2, reason: A.leaveRequests.reason, status: A.leaveRequests.status, decidedBy: A.leaveRequests.decidedBy,
    decidedAt: A.leaveRequests.decidedAt, decisionNote: A.leaveRequests.decisionNote, createdAt: A.leaveRequests.createdAt,
  }).from(A.leaveRequests).innerJoin(A.employees, eq(A.employees.id, A.leaveRequests.employeeId)).innerJoin(A.leaveTypes, eq(A.leaveTypes.id, A.leaveRequests.leaveTypeId))
    .where(conds.length ? and(...conds) : undefined).orderBy(desc(A.leaveRequests.fromDate)).limit(1000);
  res.json(rows.filter((x) => canAccess(eff, actor, x.employeeId)));
}));
function scopeOrNone(req: Request) { return scopeFor(req.actor!.roles, "leave.approve"); }

const decideBody = z.object({ note: z.string().trim().max(500).optional() });
for (const action of ["approve", "reject"] as const) {
  r.post(`/leave/requests/:id/${action}`, wrap(async (req, res) => {
    const scope = need(req, "leave.approve");
    const b = parse(decideBody, req.body ?? {});
    const [row] = await db.select().from(A.leaveRequests).where(eq(A.leaveRequests.id, idParam(req))).limit(1);
    if (!row) throw new HttpError(404, "Not found");
    if (row.employeeId === req.actor!.employeeId) throw new HttpError(403, "You cannot decide your own leave request");
    if (!canAccess(scope, req.actor!, row.employeeId)) throw new HttpError(403, "Not allowed");
    const status = action === "approve" ? "approved" : "rejected";
    const [upd] = await db.update(A.leaveRequests).set({ status, decidedBy: req.actor!.email, decidedAt: new Date(), decisionNote: b.note ?? null })
      .where(and(eq(A.leaveRequests.id, row.id), eq(A.leaveRequests.status, "pending"))).returning();
    if (!upd) throw new HttpError(409, "This request has already been decided or cancelled");
    await logAudit(req.actor!.email, `leave.${action}`, "leave_request", row.id);
    res.json(upd);
  }));
}

export default r;
