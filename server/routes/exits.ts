import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { db, schema } from "../db";
import { wrap, parse, HttpError } from "./util";
import { logAudit } from "../lib/audit";
import { need, requireHr, idParam, selfId, istDate, dateStr, parseOut } from "../lib/routeHelpers";
import { canAccess, scopeFor } from "../../shared/hr/access";

const r = Router();
const A = schema;

// ---------- resignations ----------
type ChecklistItem = { key: string; label: string; done: boolean; note?: string | null; doneBy?: string | null };
const ACTIVE_RESIGN = ["submitted", "manager_reviewed", "accepted"];

r.post("/resignations", wrap(async (req, res) => {
  const empId = selfId(req);
  const b = parse(z.object({
    proposedLastDay: dateStr, reason: z.string().trim().min(2).max(100), comments: z.string().trim().max(2000).optional(),
    noticeDays: z.number().int().min(0).max(365).nullable().optional(),
  }), req.body);
  const [emp] = await db.select().from(A.employees).where(eq(A.employees.id, empId)).limit(1);
  if (!emp || emp.status !== "active") throw new HttpError(409, "Only active employees can resign");
  if (b.proposedLastDay < istDate()) throw new HttpError(400, "Last day cannot be in the past");
  const [existing] = await db.select({ id: A.resignations.id }).from(A.resignations).where(and(eq(A.resignations.employeeId, empId), inArray(A.resignations.status, ACTIVE_RESIGN))).limit(1);
  if (existing) throw new HttpError(409, "You already have an active resignation");
  const [row] = await db.insert(A.resignations).values({ employeeId: empId, noticeDays: b.noticeDays ?? null, proposedLastDay: b.proposedLastDay, reason: b.reason, comments: b.comments ?? null }).returning();
  await logAudit(req.actor!.email, "resignation.submit", "resignation", row.id);
  res.status(201).json(row);
}));

r.post("/resignations/:id/withdraw", wrap(async (req, res) => {
  const empId = selfId(req);
  const [row] = await db.update(A.resignations).set({ status: "withdrawn" })
    .where(and(eq(A.resignations.id, idParam(req)), eq(A.resignations.employeeId, empId), inArray(A.resignations.status, ["submitted", "manager_reviewed"]))).returning();
  if (!row) throw new HttpError(409, "Only your own resignation that has not been accepted can be withdrawn");
  await logAudit(req.actor!.email, "resignation.withdraw", "resignation", row.id);
  res.json(row);
}));

r.get("/resignations", wrap(async (req, res) => {
  const scope = need(req, "resign.read");
  const rows = await db.select({
    id: A.resignations.id, employeeId: A.resignations.employeeId, code: A.employees.code, employeeName: A.employees.fullName,
    noticeDays: A.resignations.noticeDays, proposedLastDay: A.resignations.proposedLastDay, agreedLastDay: A.resignations.agreedLastDay,
    reason: A.resignations.reason, comments: A.resignations.comments, status: A.resignations.status, managerNote: A.resignations.managerNote,
    acceptedBy: A.resignations.acceptedBy, checklist: A.resignations.checklist, createdAt: A.resignations.createdAt,
  }).from(A.resignations).innerJoin(A.employees, eq(A.employees.id, A.resignations.employeeId)).orderBy(desc(A.resignations.createdAt)).limit(500);
  res.json(rows.filter((x) => canAccess(scope, req.actor!, x.employeeId)));
}));

async function getResignation(id: string) {
  const [row] = await db.select().from(A.resignations).where(eq(A.resignations.id, id)).limit(1);
  if (!row) throw new HttpError(404, "Not found");
  return row;
}

r.post("/resignations/:id/manager-review", wrap(async (req, res) => {
  const b = parse(z.object({ note: z.string().trim().min(1).max(2000) }), req.body);
  const row = await getResignation(idParam(req));
  if (row.employeeId === req.actor!.employeeId || !req.actor!.directReportIds.includes(row.employeeId)) throw new HttpError(403, "Only the employee's manager can review");
  if (!["submitted", "manager_reviewed"].includes(row.status)) throw new HttpError(409, "This resignation can no longer be reviewed");
  const [upd] = await db.update(A.resignations).set({ status: "manager_reviewed", managerNote: b.note }).where(eq(A.resignations.id, row.id)).returning();
  await logAudit(req.actor!.email, "resignation.manager_review", "resignation", row.id);
  res.json(upd);
}));

r.post("/resignations/:id/accept", wrap(async (req, res) => {
  requireHr(req); need(req, "resign.accept", "all");
  const b = parse(z.object({ agreedLastDay: dateStr }), req.body);
  const row = await getResignation(idParam(req));
  if (row.employeeId === req.actor!.employeeId) throw new HttpError(403, "You cannot accept your own resignation");
  if (!["submitted", "manager_reviewed"].includes(row.status)) throw new HttpError(409, "This resignation cannot be accepted in its current state");
  if (b.agreedLastDay < istDate()) throw new HttpError(400, "Agreed last day cannot be in the past");
  const open = await db.select({ id: A.assetAssignments.id, tag: A.assets.tag, category: A.assets.category }).from(A.assetAssignments)
    .innerJoin(A.assets, eq(A.assets.id, A.assetAssignments.assetId)).where(and(eq(A.assetAssignments.employeeId, row.employeeId), isNull(A.assetAssignments.returnedOn)));
  const claims = await db.select({ id: A.reimbClaims.id }).from(A.reimbClaims).where(and(eq(A.reimbClaims.employeeId, row.employeeId), notInArray(A.reimbClaims.status, ["paid", "rejected"])));
  const checklist: ChecklistItem[] = [
    ...open.map((a) => ({ key: `asset:${a.id}`, label: `Return asset ${a.tag} (${a.category})`, done: false })),
    { key: "handover", label: "Handover notes completed", done: false },
    { key: "reimbursements", label: claims.length ? `Settle ${claims.length} pending reimbursement claim(s)` : "Confirm no reimbursements are pending", done: false },
    { key: "exit_interview", label: "Exit interview", done: false },
  ];
  await db.transaction(async (tx) => {
    await tx.update(A.resignations).set({ status: "accepted", agreedLastDay: b.agreedLastDay, acceptedBy: req.actor!.email, checklist }).where(eq(A.resignations.id, row.id));
    await tx.update(A.employees).set({ status: "notice", lastWorkingDay: b.agreedLastDay }).where(eq(A.employees.id, row.employeeId));
  });
  await logAudit(req.actor!.email, "resignation.accept", "resignation", row.id, { agreedLastDay: b.agreedLastDay });
  res.json({ id: row.id, status: "accepted", agreedLastDay: b.agreedLastDay, checklist });
}));

r.patch("/resignations/:id/checklist", wrap(async (req, res) => {
  requireHr(req); need(req, "resign.accept", "all");
  const b = parse(z.object({ key: z.string().min(1).max(80), done: z.boolean(), note: z.string().trim().max(500).optional() }), req.body);
  const row = await getResignation(idParam(req));
  if (row.status !== "accepted") throw new HttpError(409, "Checklist is available after acceptance");
  const list = (row.checklist ?? []) as ChecklistItem[];
  const item = list.find((x) => x.key === b.key);
  if (!item) throw new HttpError(404, "Checklist item not found");
  item.done = b.done; item.doneBy = b.done ? req.actor!.email : null; if (b.note !== undefined) item.note = b.note;
  await db.update(A.resignations).set({ checklist: list }).where(eq(A.resignations.id, row.id));
  await logAudit(req.actor!.email, "resignation.checklist", "resignation", row.id, { key: b.key, done: b.done });
  res.json({ checklist: list });
}));

r.post("/resignations/:id/complete", wrap(async (req, res) => {
  requireHr(req); need(req, "resign.accept", "all");
  const b = parse(z.object({ overrideChecklist: z.boolean().optional() }), req.body ?? {});
  const row = await getResignation(idParam(req));
  if (row.status !== "accepted" || !row.agreedLastDay) throw new HttpError(409, "Accept the resignation first");
  if (istDate() <= row.agreedLastDay) throw new HttpError(409, "Cannot complete before the last working day has passed");
  const pending = ((row.checklist ?? []) as ChecklistItem[]).filter((x) => !x.done);
  if (pending.length && !b.overrideChecklist) throw new HttpError(409, `${pending.length} checklist item(s) are still open`);
  await db.transaction(async (tx) => {
    await tx.update(A.resignations).set({ status: "completed" }).where(eq(A.resignations.id, row.id));
    await tx.update(A.employees).set({ status: "exited" }).where(eq(A.employees.id, row.employeeId));
  });
  await logAudit(req.actor!.email, "resignation.complete", "resignation", row.id, { overrode: pending.length });
  res.json({ ok: true, status: "completed" });
}));

// ---------- PIPs ----------
type Goal = { goal: string; measure: string; due: string; status: string; progressNote: string | null };
type Checkpoint = { date: string; note: string | null; notedBy: string | null };

r.post("/pips", wrap(async (req, res) => {
  requireHr(req);
  const b = parseOut(z.object({
    employeeId: z.string().uuid(), startDate: dateStr, lengthDays: z.union([z.literal(30), z.literal(60), z.literal(90)]),
    concerns: z.string().trim().min(5).max(4000),
    goals: z.array(z.object({ goal: z.string().trim().min(2).max(500), measure: z.string().trim().min(2).max(500), due: dateStr })).length(3),
    support: z.string().trim().max(2000).optional(),
    checkpoints: z.array(dateStr).max(6).default([]),
  }), req.body);
  if (b.employeeId === req.actor!.employeeId) throw new HttpError(403, "You cannot issue a plan to yourself");
  const [emp] = await db.select({ id: A.employees.id, status: A.employees.status }).from(A.employees).where(eq(A.employees.id, b.employeeId)).limit(1);
  if (!emp || emp.status === "exited") throw new HttpError(404, "Employee not found");
  const [open] = await db.select({ id: A.pips.id }).from(A.pips).where(and(eq(A.pips.employeeId, b.employeeId), inArray(A.pips.status, ["active", "extended"]))).limit(1);
  if (open) throw new HttpError(409, "This employee already has an open plan");
  const goals: Goal[] = b.goals.map((g) => ({ ...g, status: "open", progressNote: null }));
  const checkpoints: Checkpoint[] = b.checkpoints.map((date) => ({ date, note: null, notedBy: null }));
  const [row] = await db.insert(A.pips).values({ employeeId: b.employeeId, startDate: b.startDate, lengthDays: b.lengthDays, concerns: b.concerns, goals, support: b.support ?? null, checkpoints, issuedBy: req.actor!.email }).returning();
  await logAudit(req.actor!.email, "pip.create", "pip", row.id, { employeeId: b.employeeId, lengthDays: b.lengthDays });
  res.status(201).json(row);
}));

r.get("/pips", wrap(async (req, res) => {
  const actor = req.actor!;
  const scope = scopeFor(actor.roles, "pip.manage");
  const rows = await db.select({
    id: A.pips.id, employeeId: A.pips.employeeId, code: A.employees.code, employeeName: A.employees.fullName, startDate: A.pips.startDate,
    lengthDays: A.pips.lengthDays, concerns: A.pips.concerns, goals: A.pips.goals, support: A.pips.support, checkpoints: A.pips.checkpoints,
    status: A.pips.status, outcome: A.pips.outcome, acknowledgedAt: A.pips.acknowledgedAt, employeeResponse: A.pips.employeeResponse, createdAt: A.pips.createdAt,
  }).from(A.pips).innerJoin(A.employees, eq(A.employees.id, A.pips.employeeId)).orderBy(desc(A.pips.createdAt)).limit(500);
  const visible = rows.filter((x) => x.employeeId === actor.employeeId || canAccess(scope, actor, x.employeeId));
  const others = visible.filter((x) => x.employeeId !== actor.employeeId);
  if (others.length) await logAudit(actor.email, "pip.read", "pip", undefined, { ids: others.map((x) => x.id) });
  res.json(visible);
}));

async function managePip(req: import("express").Request) {
  const [pip] = await db.select().from(A.pips).where(eq(A.pips.id, idParam(req))).limit(1);
  if (!pip) throw new HttpError(404, "Not found");
  const scope = need(req, "pip.manage");
  if (pip.employeeId === req.actor!.employeeId || !canAccess(scope, req.actor!, pip.employeeId)) throw new HttpError(403, "Not allowed");
  if (!["active", "extended"].includes(pip.status)) throw new HttpError(409, "This plan is closed");
  return pip;
}

r.patch("/pips/:id/goals/:idx", wrap(async (req, res) => {
  const pip = await managePip(req);
  const b = parse(z.object({ status: z.enum(["open", "on_track", "at_risk", "met", "not_met"]).optional(), progressNote: z.string().trim().max(1000).optional() }), req.body);
  const idx = Number(req.params.idx);
  const goals = pip.goals as Goal[];
  if (!Number.isInteger(idx) || !goals[idx]) throw new HttpError(404, "Goal not found");
  if (b.status) goals[idx].status = b.status;
  if (b.progressNote !== undefined) goals[idx].progressNote = b.progressNote;
  await db.update(A.pips).set({ goals }).where(eq(A.pips.id, pip.id));
  await logAudit(req.actor!.email, "pip.goal", "pip", pip.id, { idx, status: b.status });
  res.json({ goals });
}));

r.patch("/pips/:id/checkpoints/:idx", wrap(async (req, res) => {
  const pip = await managePip(req);
  const b = parse(z.object({ note: z.string().trim().min(1).max(2000) }), req.body);
  const idx = Number(req.params.idx);
  const cps = (pip.checkpoints ?? []) as Checkpoint[];
  if (!Number.isInteger(idx) || !cps[idx]) throw new HttpError(404, "Checkpoint not found");
  cps[idx].note = b.note; cps[idx].notedBy = req.actor!.email;
  await db.update(A.pips).set({ checkpoints: cps }).where(eq(A.pips.id, pip.id));
  await logAudit(req.actor!.email, "pip.checkpoint", "pip", pip.id, { idx });
  res.json({ checkpoints: cps });
}));

async function ownPip(req: import("express").Request) {
  const empId = selfId(req);
  const [pip] = await db.select().from(A.pips).where(and(eq(A.pips.id, idParam(req)), eq(A.pips.employeeId, empId))).limit(1);
  if (!pip) throw new HttpError(404, "Not found");
  return pip;
}
/** Acknowledges receipt only. It does not mean agreement. */
r.post("/pips/:id/acknowledge", wrap(async (req, res) => {
  const pip = await ownPip(req);
  if (!pip.acknowledgedAt) {
    await db.update(A.pips).set({ acknowledgedAt: new Date() }).where(eq(A.pips.id, pip.id));
    await logAudit(req.actor!.email, "pip.acknowledge", "pip", pip.id);
  }
  res.json({ acknowledged: true, note: "Acknowledgement confirms you received this plan, not that you agree with it." });
}));
r.put("/pips/:id/response", wrap(async (req, res) => {
  const pip = await ownPip(req);
  if (!["active", "extended"].includes(pip.status)) throw new HttpError(409, "This plan is closed");
  const b = parse(z.object({ text: z.string().trim().min(1).max(5000) }), req.body);
  await db.update(A.pips).set({ employeeResponse: b.text }).where(eq(A.pips.id, pip.id));
  await logAudit(req.actor!.email, "pip.response", "pip", pip.id);
  res.json({ ok: true });
}));

/** Records an outcome only. Ending employment is a separate decision made outside this system. */
r.post("/pips/:id/close", wrap(async (req, res) => {
  requireHr(req);
  const b = parse(z.object({ outcome: z.enum(["met", "extended", "not_met", "withdrawn"]), note: z.string().trim().max(2000).optional() }), req.body);
  const pip = await managePip(req);
  const status = b.outcome === "met" ? "completed" : b.outcome === "extended" ? "extended" : "closed";
  const outcome = b.note ? `${b.outcome}: ${b.note}` : b.outcome;
  const [upd] = await db.update(A.pips).set({ status, outcome }).where(eq(A.pips.id, pip.id)).returning();
  await logAudit(req.actor!.email, "pip.close", "pip", pip.id, { outcome: b.outcome });
  res.json(upd);
}));

export default r;
