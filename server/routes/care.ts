import { Router } from "express";
import { z } from "zod";
import { and, asc, desc, eq, inArray, isNotNull, lt, or } from "drizzle-orm";
import { db, schema as S } from "../db";
import { wrap, parse, HttpError } from "./util";
import { selfId } from "../lib/routeHelpers";
import { sendEmail } from "../lib/email";
import { env } from "../env";
import { careInput, CARE_RETENTION_DAYS } from "../../shared/hr/buzz";

/**
 * Private 1:1 conversations ("counselling sessions") with your manager or the CEO, offered after a low check-in.
 * Only the person who asked and the person they asked can see a request. HR, dashboards and the audit log never do,
 * and nothing here links back to the anonymous check-in answers.
 */
const r = Router();
const uuid = z.string().uuid();
const OPEN = ["requested", "scheduled"];

/** The CEO is the super admin with an active employee record (the earliest joiner if there is more than one). */
async function ceo() {
  const admins = await db.select({ email: S.userRoles.email }).from(S.userRoles).where(eq(S.userRoles.role, "super_admin"));
  if (!admins.length) return null;
  const [e] = await db.select({ id: S.employees.id, fullName: S.employees.fullName, workEmail: S.employees.workEmail }).from(S.employees)
    .where(and(inArray(S.employees.workEmail, admins.map((a) => a.email)), eq(S.employees.status, "active"))).orderBy(asc(S.employees.joiningDate)).limit(1);
  return e ?? null;
}
async function manager(me: string) {
  const [self] = await db.select({ managerId: S.employees.managerId }).from(S.employees).where(eq(S.employees.id, me)).limit(1);
  if (!self?.managerId) return null;
  const [m] = await db.select({ id: S.employees.id, fullName: S.employees.fullName, workEmail: S.employees.workEmail, status: S.employees.status }).from(S.employees).where(eq(S.employees.id, self.managerId)).limit(1);
  return m && m.status !== "exited" ? m : null;
}
/** Erase conversations that closed more than 90 days ago. Runs on read, so nothing lingers past the promise. */
async function purge() {
  await db.delete(S.careRequests).where(and(isNotNull(S.careRequests.closedAt), lt(S.careRequests.closedAt, new Date(Date.now() - CARE_RETENTION_DAYS * 864e5))));
}

r.get("/care/options", wrap(async (req, res) => {
  const me = selfId(req);
  const [m, c] = await Promise.all([manager(me), ceo()]);
  res.json({ manager: m && m.id !== me ? { name: m.fullName } : null, ceo: c && c.id !== me ? { name: c.fullName } : null });
}));

r.get("/care", wrap(async (req, res) => {
  const me = selfId(req);
  await purge();
  const rows = await db.select().from(S.careRequests).where(or(eq(S.careRequests.requesterId, me), eq(S.careRequests.counsellorId, me))).orderBy(desc(S.careRequests.createdAt));
  const ids = [...new Set(rows.flatMap((x) => [x.requesterId, x.counsellorId]))];
  const names = new Map((ids.length ? await db.select({ id: S.employees.id, fullName: S.employees.fullName }).from(S.employees).where(inArray(S.employees.id, ids)) : []).map((e) => [e.id, e.fullName]));
  const view = (x: (typeof rows)[number]) => ({ id: x.id, with: x.withWhom, mode: x.mode, when: x.preferredWhen, note: x.note, status: x.status, scheduledFor: x.scheduledFor, reply: x.reply, createdAt: x.createdAt });
  res.json({
    mine: rows.filter((x) => x.requesterId === me).map((x) => ({ ...view(x), counsellor: names.get(x.counsellorId) ?? "" })),
    toMe: rows.filter((x) => x.counsellorId === me && x.requesterId !== me && x.status !== "cancelled").map((x) => ({ ...view(x), requester: names.get(x.requesterId) ?? "" })),
  });
}));

r.post("/care", wrap(async (req, res) => {
  const me = selfId(req);
  const b = parse(careInput, req.body);
  const who = b.with === "manager" ? await manager(me) : await ceo();
  if (!who || who.id === me) throw new HttpError(400, b.with === "manager" ? "You don't have a manager set up yet. You can ask the CEO instead." : "The CEO isn't set up in the app yet.");
  const [open] = await db.select({ id: S.careRequests.id }).from(S.careRequests)
    .where(and(eq(S.careRequests.requesterId, me), eq(S.careRequests.counsellorId, who.id), inArray(S.careRequests.status, OPEN))).limit(1);
  if (open) throw new HttpError(409, "You already have a conversation lined up with them. You'll see it on your Home page.");
  const [row] = await db.insert(S.careRequests).values({ requesterId: me, counsellorId: who.id, withWhom: b.with, mode: b.mode, preferredWhen: b.when, note: b.note || null }).returning({ id: S.careRequests.id });
  const [self] = await db.select({ fullName: S.employees.fullName }).from(S.employees).where(eq(S.employees.id, me)).limit(1);
  // The email says who asked and nothing else: no note, no check-in answers.
  void sendEmail({ to: who.workEmail, subject: "Someone would like a private conversation with you",
    text: `${self?.fullName ?? "A colleague"} has asked for a private 1:1 conversation with you. Please open ${env.HR_APP_URL}/home to suggest a time. Only the two of you can see this request.` });
  res.status(201).json({ id: row.id });
}));

const act = z.discriminatedUnion("action", [
  z.object({ action: z.literal("schedule"), at: z.string().datetime({ offset: true }), reply: z.string().trim().max(500).optional() }).strict(),
  z.object({ action: z.literal("done") }).strict(),
]);
/** The person asked suggests a time, or either side marks it done. */
r.post("/care/:id", wrap(async (req, res) => {
  const me = selfId(req);
  const id = parse(uuid, req.params.id);
  const b = parse(act, req.body);
  const [x] = await db.select().from(S.careRequests).where(eq(S.careRequests.id, id)).limit(1);
  if (!x || (x.counsellorId !== me && x.requesterId !== me)) throw new HttpError(404, "Not found");
  if (!OPEN.includes(x.status)) throw new HttpError(409, "This conversation is already closed");
  if (b.action === "schedule") {
    if (x.counsellorId !== me) throw new HttpError(403, "Only the person asked can set the time");
    await db.update(S.careRequests).set({ status: "scheduled", scheduledFor: new Date(b.at), reply: b.reply || null }).where(eq(S.careRequests.id, id));
    const [asker] = await db.select({ workEmail: S.employees.workEmail }).from(S.employees).where(eq(S.employees.id, x.requesterId)).limit(1);
    if (asker) void sendEmail({ to: asker.workEmail, subject: "Your 1:1 conversation has a time", text: `Your private conversation has a time. Open ${env.HR_APP_URL}/home to see it.` });
  } else {
    await db.update(S.careRequests).set({ status: "done", closedAt: new Date() }).where(eq(S.careRequests.id, id));
  }
  res.json({ ok: true });
}));

/** The person who asked can withdraw at any time. The request is erased, not kept. */
r.delete("/care/:id", wrap(async (req, res) => {
  const me = selfId(req);
  const id = parse(uuid, req.params.id);
  const gone = await db.delete(S.careRequests).where(and(eq(S.careRequests.id, id), eq(S.careRequests.requesterId, me))).returning({ id: S.careRequests.id });
  if (!gone.length) throw new HttpError(404, "Not found");
  res.json({ ok: true });
}));

export default r;
