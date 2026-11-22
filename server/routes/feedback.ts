import { Router } from "express";
import { z } from "zod";
import { randomBytes, randomInt } from "node:crypto";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { wrap, parse, HttpError } from "./util";
import { logAudit } from "../lib/audit";
import { hmac } from "../lib/crypto";
import { RateLimiter } from "../lib/otpLogic";
import { requireHr, idParam, selfId, istDate, parseOut, monthRange } from "../lib/routeHelpers";
import { MIN_ANONYMOUS_RESPONSES, shouldShowResults } from "../../shared/hr/misc";

const r = Router();
const A = schema;
const lookupLimiter = new RateLimiter();

// ---------- ESAT (anonymous) ----------
type Question = { id: string; type: "rating" | "text"; text: string };
const questionsSchema = z.array(z.object({ id: z.string().regex(/^[a-z0-9_]{1,30}$/), type: z.enum(["rating", "text"]), text: z.string().trim().min(3).max(300) })).min(1).max(30)
  .refine((qs) => new Set(qs.map((q) => q.id)).size === qs.length, "Question ids must be unique");

const marker = (employeeId: string, cycleId: string) => hmac(`${employeeId}:${cycleId}`, "esat");

r.get("/esat/current", wrap(async (req, res) => {
  const empId = selfId(req);
  const [cycle] = await db.select().from(A.esatCycles).where(eq(A.esatCycles.status, "open")).orderBy(desc(A.esatCycles.createdAt)).limit(1);
  if (!cycle) return res.json({ cycle: null });
  const [p] = await db.select({ id: A.esatParticipation.id }).from(A.esatParticipation).where(and(eq(A.esatParticipation.cycleId, cycle.id), eq(A.esatParticipation.markerHash, marker(empId, cycle.id)))).limit(1);
  res.json({ cycle: { id: cycle.id, title: cycle.title, questions: cycle.questions }, participated: !!p });
}));

/**
 * Participation marker and answer row are written as two separate autocommit statements on purpose:
 * no shared transaction id, no shared key, no timestamps finer than a day, random uuid ids (no sequence order).
 */
r.post("/esat/responses", wrap(async (req, res) => {
  const empId = selfId(req);
  const b = parse(z.object({ cycleId: z.string().uuid(), answers: z.record(z.union([z.number(), z.string()])) }), req.body);
  const [cycle] = await db.select().from(A.esatCycles).where(and(eq(A.esatCycles.id, b.cycleId), eq(A.esatCycles.status, "open"))).limit(1);
  if (!cycle) throw new HttpError(404, "This survey is not open");
  const qs = cycle.questions as Question[];
  const answers: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(b.answers)) {
    const q = qs.find((x) => x.id === k);
    if (!q) throw new HttpError(400, "Unknown question");
    if (q.type === "rating") { if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 5) throw new HttpError(400, "Ratings must be whole numbers from 1 to 5"); answers[k] = v; }
    else { if (typeof v !== "string") throw new HttpError(400, "Invalid answer"); const t = v.trim(); if (t) answers[k] = t.slice(0, 2000); }
  }
  if (!Object.keys(answers).length) throw new HttpError(400, "Answer at least one question");
  const claimed = await db.insert(A.esatParticipation).values({ cycleId: cycle.id, markerHash: marker(empId, cycle.id) }).onConflictDoNothing().returning({ id: A.esatParticipation.id });
  if (!claimed.length) throw new HttpError(409, "You have already taken part in this survey");
  try {
    await db.insert(A.esatResponses).values({ cycleId: cycle.id, answers, submittedDay: istDate() });
  } catch (e) {
    await db.delete(A.esatParticipation).where(eq(A.esatParticipation.id, claimed[0].id)); // let them retry
    throw e;
  }
  res.status(201).json({ ok: true });
}));

r.get("/esat/cycles", wrap(async (req, res) => {
  requireHr(req);
  res.json(await db.select().from(A.esatCycles).orderBy(desc(A.esatCycles.createdAt)));
}));
r.post("/esat/cycles", wrap(async (req, res) => {
  requireHr(req);
  const b = parse(z.object({ title: z.string().trim().min(3).max(120), questions: questionsSchema }), req.body);
  const [open] = await db.select({ id: A.esatCycles.id }).from(A.esatCycles).where(eq(A.esatCycles.status, "open")).limit(1);
  if (open) throw new HttpError(409, "Close the open survey before starting another");
  const [row] = await db.insert(A.esatCycles).values(b).returning();
  await logAudit(req.actor!.email, "esat.cycle.create", "esat_cycle", row.id);
  res.status(201).json(row);
}));
r.post("/esat/cycles/:id/close", wrap(async (req, res) => {
  requireHr(req);
  const [row] = await db.update(A.esatCycles).set({ status: "closed" }).where(and(eq(A.esatCycles.id, idParam(req)), eq(A.esatCycles.status, "open"))).returning();
  if (!row) throw new HttpError(409, "Survey not found or already closed");
  await logAudit(req.actor!.email, "esat.cycle.close", "esat_cycle", row.id);
  res.json(row);
}));

function shuffle<T>(a: T[]): T[] { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = randomInt(i + 1); [x[i], x[j]] = [x[j], x[i]]; } return x; }

r.get("/esat/results", wrap(async (req, res) => {
  requireHr(req);
  const q = z.object({ cycleId: z.string().uuid().optional() }).parse(req.query);
  const [cycle] = q.cycleId
    ? await db.select().from(A.esatCycles).where(eq(A.esatCycles.id, q.cycleId)).limit(1)
    : await db.select().from(A.esatCycles).orderBy(desc(A.esatCycles.createdAt)).limit(1);
  if (!cycle) throw new HttpError(404, "No survey found");
  const rows = await db.select({ answers: A.esatResponses.answers }).from(A.esatResponses).where(eq(A.esatResponses.cycleId, cycle.id));
  if (!shouldShowResults(rows.length)) return res.json({ hidden: true, minResponses: MIN_ANONYMOUS_RESPONSES });
  const qs = cycle.questions as Question[];
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(A.employees).where(inArray(A.employees.status, ["active", "notice"]));
  const out = qs.map((qu) => {
    const vals = rows.map((x) => (x.answers as Record<string, number | string>)[qu.id]).filter((v) => v !== undefined);
    if (qu.type === "rating") {
      const nums = vals.filter((v): v is number => typeof v === "number");
      const dist = [1, 2, 3, 4, 5].map((k) => nums.filter((v) => v === k).length);
      return { id: qu.id, text: qu.text, type: qu.type, count: nums.length, average: nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null, distribution: dist };
    }
    const texts = vals.filter((v): v is string => typeof v === "string");
    return { id: qu.id, text: qu.text, type: qu.type, count: texts.length, comments: texts.length >= MIN_ANONYMOUS_RESPONSES ? shuffle(texts) : [] };
  });
  res.json({ hidden: false, cycle: { id: cycle.id, title: cycle.title, status: cycle.status }, responses: rows.length, participationPct: n ? Math.round((rows.length / n) * 100) : null, questions: out });
}));

// ---------- suggestion box ----------
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newReplyCode(): string {
  const b = randomBytes(12);
  const c = Array.from(b, (x) => ALPHABET[x % ALPHABET.length]).join("");
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`;
}
const codeHash = (code: string) => hmac(code.replace(/[^A-Za-z0-9]/g, ""), "suggestion");

r.post("/suggestions", wrap(async (req, res) => {
  const b = parse(z.object({ body: z.string().trim().min(3).max(5000), anonymous: z.literal(true).optional() }), req.body);
  // No identity is stored or logged for suggestions, whatever the request says.
  const replyCode = newReplyCode();
  await db.insert(A.suggestions).values({ body: b.body, replyCodeHash: codeHash(replyCode), createdDay: istDate() });
  res.status(201).json({ replyCode, note: "Save this code now. It is shown once and is the only way to see a reply." });
}));
r.get("/suggestions", wrap(async (req, res) => {
  requireHr(req);
  res.json(await db.select({ id: A.suggestions.id, body: A.suggestions.body, status: A.suggestions.status, reply: A.suggestions.reply, createdDay: A.suggestions.createdDay }).from(A.suggestions).orderBy(desc(A.suggestions.createdDay)).limit(500));
}));
r.post("/suggestions/:id/reply", wrap(async (req, res) => {
  requireHr(req);
  const b = parse(z.object({ reply: z.string().trim().min(1).max(3000), status: z.enum(["in_review", "replied", "closed"]).default("replied").optional() }), req.body);
  const [row] = await db.update(A.suggestions).set({ reply: b.reply, status: b.status ?? "replied" }).where(eq(A.suggestions.id, idParam(req))).returning({ id: A.suggestions.id, status: A.suggestions.status });
  if (!row) throw new HttpError(404, "Not found");
  await logAudit(req.actor!.email, "suggestion.reply", "suggestion", row.id);
  res.json(row);
}));
r.post("/suggestions/lookup", wrap(async (req, res) => {
  if (!lookupLimiter.hit(`l:${req.actor!.email}`, 20, 10 * 60_000)) throw new HttpError(429, "Too many attempts. Please try again later.");
  const b = parse(z.object({ replyCode: z.string().trim().min(8).max(30) }), req.body);
  const [row] = await db.select({ status: A.suggestions.status, reply: A.suggestions.reply, createdDay: A.suggestions.createdDay }).from(A.suggestions).where(eq(A.suggestions.replyCodeHash, codeHash(b.replyCode))).limit(1);
  if (!row) throw new HttpError(404, "No suggestion found for that code");
  res.json(row);
}));

// ---------- dashboard trends ----------
function lastMonths(n: number, today = istDate()): string[] {
  let y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const out: string[] = [];
  for (let i = 0; i < n; i++) { out.unshift(`${y}-${String(m).padStart(2, "0")}`); m--; if (m === 0) { m = 12; y--; } }
  return out;
}

r.get("/dashboard/trends", wrap(async (req, res) => {
  requireHr(req);
  const today = istDate();
  const months6 = lastMonths(6, today);
  const months3 = months6.slice(-3);
  const runs = await db.select({ month: A.payrollRuns.month, net: A.payslips.netPayPaise }).from(A.payslips)
    .innerJoin(A.payrollRuns, eq(A.payrollRuns.id, A.payslips.runId)).where(and(inArray(A.payrollRuns.status, ["locked", "paid"]), inArray(A.payrollRuns.month, months3)));
  const netSalary = months3.map((m) => { const rs = runs.filter((x) => x.month === m); return { month: m, netPaise: rs.reduce((a, x) => a + x.net, 0), payslips: rs.length }; });

  const emps = await db.select({ id: A.employees.id, joiningDate: A.employees.joiningDate, status: A.employees.status, lastWorkingDay: A.employees.lastWorkingDay, departmentId: A.employees.departmentId }).from(A.employees);
  const exitDay = (e: (typeof emps)[number]) => (e.status === "active" ? null : e.lastWorkingDay);
  const headcount = months6.map((m) => {
    const { to } = monthRange(m);
    return { month: m, headcount: emps.filter((e) => e.joiningDate <= to && !(exitDay(e) && exitDay(e)! <= to)).length };
  });
  const joiners = months6.map((m) => { const { from, to } = monthRange(m); return { month: m, count: emps.filter((e) => e.joiningDate >= from && e.joiningDate <= to).length }; });
  const offboarding = months6.map((m) => { const { from, to } = monthRange(m); return { month: m, count: emps.filter((e) => { const d = exitDay(e); return !!d && d >= from && d <= to; }).length }; });

  const [onLeave] = await db.select({ n: sql<number>`count(distinct ${A.leaveRequests.employeeId})::int` }).from(A.leaveRequests)
    .where(and(eq(A.leaveRequests.status, "approved"), sql`${A.leaveRequests.fromDate} <= ${today}`, gte(A.leaveRequests.toDate, today)));
  const [pendingLeave] = await db.select({ n: sql<number>`count(*)::int` }).from(A.leaveRequests).where(eq(A.leaveRequests.status, "pending"));
  const [openResign] = await db.select({ n: sql<number>`count(*)::int` }).from(A.resignations).where(inArray(A.resignations.status, ["submitted", "manager_reviewed", "accepted"]));
  const [openPips] = await db.select({ n: sql<number>`count(*)::int` }).from(A.pips).where(inArray(A.pips.status, ["active", "extended"]));
  const org = {
    total: emps.length, active: emps.filter((e) => e.status === "active").length, onNotice: emps.filter((e) => e.status === "notice").length, exited: emps.filter((e) => e.status === "exited").length,
    onLeaveToday: onLeave?.n ?? 0, pendingLeaveRequests: pendingLeave?.n ?? 0, openResignations: openResign?.n ?? 0, openPips: openPips?.n ?? 0,
  };
  res.json({ asOf: today, netSalary, headcount, joiners, offboarding, org });
}));

void parseOut;
export default r;
