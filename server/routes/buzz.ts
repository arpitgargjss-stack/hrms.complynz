import { Router, type Request } from "express";
import { z } from "zod";
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne } from "drizzle-orm";
import { db, schema as S } from "../db";
import { wrap, parse, HttpError } from "./util";
import { logAudit } from "../lib/audit";
import { hmac } from "../lib/crypto";
import { istDate, addDays } from "../lib/routeHelpers";
import { startStreak, longWeekendTips, isoWeek, kudosInput, pulseInput, toIndex } from "../../shared/hr/buzz";
import { shouldShowResults, MIN_ANONYMOUS_RESPONSES } from "../../shared/hr/misc";
import type { CalendarSettings } from "../../shared/hr/leave";

const r = Router();
const uuid = z.string().uuid();
const DEFAULT_CAL: CalendarSettings = { weeklyOff: [0], saturdays: { mode: "alternate", offWeeks: [2, 4] }, workStart: "09:30", workEnd: "18:30" };
function selfId(req: Request): string {
  const id = req.actor?.employeeId;
  if (!id) throw new HttpError(404, "No employee record is linked to this login");
  return id;
}
async function calendar(): Promise<CalendarSettings> {
  const [row] = await db.select().from(S.workCalendar).orderBy(desc(S.workCalendar.id)).limit(1);
  return row ? (row.settings as CalendarSettings) : DEFAULT_CAL;
}

// =====================================================================
// Home: "your day" strip
// =====================================================================
r.get("/home/today", wrap(async (req, res) => {
  const me = selfId(req);
  const today = istDate();
  const from = addDays(today, -180);
  const [emp] = await db.select().from(S.employees).where(eq(S.employees.id, me)).limit(1);
  if (!emp) throw new HttpError(404, "Not found");
  const [cal, hols, punches, leaves, slips, claims, joiners] = await Promise.all([
    calendar(),
    db.select().from(S.holidays).where(and(gte(S.holidays.date, from), lte(S.holidays.date, addDays(today, 120)))),
    db.select({ kind: S.attendancePunches.kind, at: S.attendancePunches.at, workDate: S.attendancePunches.workDate }).from(S.attendancePunches)
      .where(and(eq(S.attendancePunches.employeeId, me), gte(S.attendancePunches.workDate, from))).orderBy(asc(S.attendancePunches.at)),
    db.select().from(S.leaveRequests).where(and(eq(S.leaveRequests.employeeId, me), eq(S.leaveRequests.status, "approved"), gte(S.leaveRequests.toDate, from))),
    db.select({ month: S.payrollRuns.month }).from(S.payslips).innerJoin(S.payrollRuns, eq(S.payslips.runId, S.payrollRuns.id))
      .where(and(eq(S.payslips.employeeId, me), inArray(S.payrollRuns.status, ["locked", "paid"]))).orderBy(desc(S.payrollRuns.month)).limit(1),
    db.select({ amountPaise: S.reimbClaims.amountPaise, status: S.reimbClaims.status }).from(S.reimbClaims).where(and(eq(S.reimbClaims.employeeId, me), inArray(S.reimbClaims.status, ["approved", "paid"]))).orderBy(desc(S.reimbClaims.createdAt)).limit(1),
    db.select({ id: S.employees.id, fullName: S.employees.fullName, photoFileId: S.employees.photoFileId, joiningDate: S.employees.joiningDate, departmentId: S.employees.departmentId })
      .from(S.employees).where(and(ne(S.employees.status, "exited"), gte(S.employees.joiningDate, addDays(today, -14)), lte(S.employees.joiningDate, today), ne(S.employees.id, me))),
  ]);
  const holidays = hols.map((h) => ({ date: h.date, name: h.name, optional: !!h.optional }));
  const onLeave = (d: string) => leaves.some((l) => l.fromDate <= d && l.toDate >= d);
  const todays = punches.filter((p) => p.workDate === today);
  const last = todays[todays.length - 1];
  const firstIn = todays.find((p) => p.kind === "in");
  const streak = startStreak(today, new Set(punches.filter((p) => p.kind === "in").map((p) => p.workDate)), onLeave, cal, holidays);
  // Monday to Friday of this week, for the little dots
  const dow = new Date(today + "T00:00:00Z").getUTCDay() || 7;
  const monday = addDays(today, 1 - dow);
  const week = Array.from({ length: 5 }, (_, i) => {
    const d = addDays(monday, i);
    const st = d > today ? "future" : onLeave(d) ? "leave" : holidays.some((h) => h.date === d && !h.optional) ? "holiday" : punches.some((p) => p.workDate === d && p.kind === "in") ? "done" : d === today ? "today" : "missed";
    return { date: d, status: st };
  });
  const depts = new Map((await db.select().from(S.departments)).map((d) => [d.id, d.name]));
  res.json({
    today, firstName: emp.fullName.split(/\s+/)[0], workStart: cal.workStart, latestStart: cal.latestStart ?? null,
    day: { state: !last ? "not_started" : last.kind === "in" ? "working" : "done", startedAt: firstIn?.at ?? null },
    streak, week,
    longWeekend: longWeekendTips(today, cal, holidays)[0] ?? null,
    latestPayslip: slips[0]?.month ?? null,
    lastClaim: claims[0] ?? null,
    newJoiners: joiners.map((j) => ({ id: j.id, fullName: j.fullName, photoFileId: j.photoFileId, joiningDate: j.joiningDate, department: j.departmentId ? depts.get(j.departmentId) ?? null : null })),
  });
}));

// =====================================================================
// Kudos
// =====================================================================
r.get("/kudos", wrap(async (req, res) => {
  const me = selfId(req);
  const q = parse(z.object({ to: uuid.optional(), value: z.string().max(40).optional() }), req.query);
  const rows = await db.select().from(S.kudos).where(and(isNull(S.kudos.deletedAt), isNull(S.kudos.hiddenAt), q.to ? eq(S.kudos.toEmployeeId, q.to) : undefined, q.value ? eq(S.kudos.value, q.value) : undefined))
    .orderBy(desc(S.kudos.createdAt)).limit(60);
  const ids = [...new Set(rows.flatMap((k) => [k.fromEmployeeId, k.toEmployeeId]))];
  const people = ids.length ? await db.select({ id: S.employees.id, fullName: S.employees.fullName, photoFileId: S.employees.photoFileId, status: S.employees.status }).from(S.employees).where(inArray(S.employees.id, ids)) : [];
  const P = new Map(people.map((p) => [p.id, p]));
  const reacts = rows.length ? await db.select().from(S.kudosReactions).where(inArray(S.kudosReactions.kudosId, rows.map((k) => k.id))) : [];
  const given = (await db.select({ id: S.kudos.id }).from(S.kudos).where(and(eq(S.kudos.fromEmployeeId, me), isNull(S.kudos.deletedAt), gte(S.kudos.createdAt, new Date(Date.now() - 7 * 86400_000))))).length;
  res.json({
    givenThisWeek: given,
    items: rows.filter((k) => P.get(k.fromEmployeeId)?.status !== "exited" && P.get(k.toEmployeeId)?.status !== "exited").map((k) => {
      const rs = reacts.filter((x) => x.kudosId === k.id);
      const who = (id: string) => ({ id, fullName: P.get(id)?.fullName ?? "Someone", photoFileId: P.get(id)?.photoFileId ?? null });
      return { id: k.id, from: who(k.fromEmployeeId), to: who(k.toEmployeeId), value: k.value, message: k.message, createdAt: k.createdAt,
        counts: { clap: rs.filter((x) => x.kind === "clap").length, fire: rs.filter((x) => x.kind === "fire").length },
        mine: rs.filter((x) => x.employeeId === me).map((x) => x.kind), canHide: k.toEmployeeId === me, canDelete: k.fromEmployeeId === me || !!req.actor?.roles.has("hr_admin") };
    }),
  });
}));
r.post("/kudos", wrap(async (req, res) => {
  const me = selfId(req);
  const b = parse(kudosInput, req.body);
  if (b.toEmployeeId === me) throw new HttpError(400, "Kudos are for someone else");
  const [to] = await db.select({ id: S.employees.id, status: S.employees.status }).from(S.employees).where(eq(S.employees.id, b.toEmployeeId)).limit(1);
  if (!to || to.status === "exited") throw new HttpError(404, "Colleague not found");
  const [k] = await db.insert(S.kudos).values({ fromEmployeeId: me, toEmployeeId: b.toEmployeeId, value: b.value, message: b.message }).returning();
  res.status(201).json({ id: k.id });
}));
r.post("/kudos/:id/react", wrap(async (req, res) => {
  const me = selfId(req);
  const id = parse(uuid, req.params.id);
  const b = parse(z.object({ kind: z.enum(["clap", "fire"]), on: z.boolean() }).strict(), req.body);
  const [k] = await db.select({ id: S.kudos.id }).from(S.kudos).where(and(eq(S.kudos.id, id), isNull(S.kudos.deletedAt), isNull(S.kudos.hiddenAt))).limit(1);
  if (!k) throw new HttpError(404, "Not found");
  if (b.on) await db.insert(S.kudosReactions).values({ kudosId: id, employeeId: me, kind: b.kind }).onConflictDoNothing();
  else await db.delete(S.kudosReactions).where(and(eq(S.kudosReactions.kudosId, id), eq(S.kudosReactions.employeeId, me), eq(S.kudosReactions.kind, b.kind)));
  res.json({ ok: true });
}));
/** The person thanked can take a kudos off the wall. */
r.post("/kudos/:id/hide", wrap(async (req, res) => {
  const me = selfId(req);
  const id = parse(uuid, req.params.id);
  const [k] = await db.update(S.kudos).set({ hiddenAt: new Date() }).where(and(eq(S.kudos.id, id), eq(S.kudos.toEmployeeId, me))).returning();
  if (!k) throw new HttpError(404, "Not found");
  res.json({ ok: true });
}));
r.delete("/kudos/:id", wrap(async (req, res) => {
  const me = selfId(req);
  const id = parse(uuid, req.params.id);
  const [k] = await db.select().from(S.kudos).where(and(eq(S.kudos.id, id), isNull(S.kudos.deletedAt))).limit(1);
  if (!k) throw new HttpError(404, "Not found");
  const own = k.fromEmployeeId === me;
  if (!own && !req.actor?.roles.has("hr_admin")) throw new HttpError(403, "Not allowed");
  await db.update(S.kudos).set({ deletedAt: new Date() }).where(eq(S.kudos.id, id));
  if (!own) await logAudit(req.actor!.email, "kudos.remove", "kudos", id, {});
  res.json({ ok: true });
}));

// =====================================================================
// Weekly pulse (anonymous)
// =====================================================================
const marker = (employeeId: string, week: string) => hmac(`${employeeId}:${week}`, "pulse");
const avg1 = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => typeof x === "number"); return v.length >= MIN_ANONYMOUS_RESPONSES ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null; };
async function pulseState(me: string) {
  const today = istDate();
  const week = isoWeek(today);
  const [emp] = await db.select({ departmentId: S.employees.departmentId }).from(S.employees).where(eq(S.employees.id, me)).limit(1);
  const [p] = await db.select({ id: S.pulseParticipation.id }).from(S.pulseParticipation).where(and(eq(S.pulseParticipation.week, week), eq(S.pulseParticipation.markerHash, marker(me, week)))).limit(1);
  const rows = await db.select({ mood: S.pulseResponses.mood, stress: S.pulseResponses.stress, motivation: S.pulseResponses.motivation }).from(S.pulseResponses)
    .where(and(eq(S.pulseResponses.week, week), emp?.departmentId ? eq(S.pulseResponses.departmentId, emp.departmentId) : isNull(S.pulseResponses.departmentId)));
  const count = rows.length;
  // Each index is shown only when 5 or more people answered that question, as 0 to 100.
  const team = shouldShowResults(count)
    ? { count, indexes: { stress: toIndex(avg1(rows.map((x) => x.stress))), mood: toIndex(avg1(rows.map((x) => x.mood))), motivation: toIndex(avg1(rows.map((x) => x.motivation))) } }
    : { count, needed: MIN_ANONYMOUS_RESPONSES };
  return { week, answered: !!p, team };
}
r.get("/pulse", wrap(async (req, res) => { res.json(await pulseState(selfId(req))); }));
r.post("/pulse", wrap(async (req, res) => {
  const me = selfId(req);
  const b = parse(pulseInput, req.body);
  const week = isoWeek(istDate());
  const [emp] = await db.select({ departmentId: S.employees.departmentId }).from(S.employees).where(eq(S.employees.id, me)).limit(1);
  // Participation marker and answer are separate rows with nothing joining them.
  const claimed = await db.insert(S.pulseParticipation).values({ week, markerHash: marker(me, week) }).onConflictDoNothing().returning({ id: S.pulseParticipation.id });
  if (!claimed.length) throw new HttpError(409, "You've already answered this week");
  await db.insert(S.pulseResponses).values({ week, departmentId: emp?.departmentId ?? null, mood: b.mood, stress: b.stress, motivation: b.motivation, submittedDay: istDate() });
  res.status(201).json(await pulseState(me));
}));

export default r;
