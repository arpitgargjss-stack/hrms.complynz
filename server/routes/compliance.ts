import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { db, schema } from "../db";
import { wrap, parse, HttpError } from "./util";
import { logAudit } from "../lib/audit";
import { need, istDate } from "../lib/routeHelpers";
import { DEFAULT_FACTS, INDUSTRIES, ITEMS, TURNOVER_BANDS, nextDue, prevDue, periodOf, type CompanyFacts } from "../../shared/hr/compliance";
import { COMPANY_DEFAULTS, type CompanyProfile } from "../../shared/hr/letters";
import { INDIAN_STATES } from "../../shared/hr/presets";
import { renderComplianceTemplate } from "../lib/complianceTemplates";

/**
 * Compliance centre. What applies is worked out from live headcount, interns and office states, plus the company facts HR sets.
 * HR and finance mark each due period done (or not applicable) and the list moves on to the next one.
 */
const r = Router();
const A = schema;
const gate = (req: Parameters<typeof need>[0]) => need(req, "compliance.manage", "all");
type Profile = Omit<CompanyFacts, "headcount" | "interns" | "states"> & { extraStates: string[] };

async function profile(): Promise<Profile> {
  const [row] = await db.select().from(A.complianceProfile).orderBy(desc(A.complianceProfile.id)).limit(1);
  return { ...DEFAULT_FACTS, extraStates: [], ...((row?.settings ?? {}) as Partial<Profile>) };
}
async function counts() {
  const rows = await db.select({ type: A.employees.employmentType, state: A.locations.state }).from(A.employees)
    .leftJoin(A.locations, eq(A.locations.id, A.employees.locationId)).where(inArray(A.employees.status, ["active", "notice"]));
  const offices = await db.select({ state: A.locations.state }).from(A.locations).where(and(isNotNull(A.locations.state), eq(A.locations.isRemote, false)));
  const states = [...new Set([...offices.map((o) => o.state!), ...rows.map((x) => x.state).filter((s): s is string => !!s)])].sort();
  return { headcount: rows.filter((x) => x.type !== "intern").length, interns: rows.filter((x) => x.type === "intern").length, states };
}
export async function facts(): Promise<CompanyFacts & { officeStates: string[]; extraStates: string[] }> {
  const [p, c] = await Promise.all([profile(), counts()]);
  const { extraStates, ...rest } = p;
  return { ...rest, ...c, states: [...new Set([...c.states, ...extraStates])].sort(), officeStates: c.states, extraStates };
}

const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const addDay = (d: string) => new Date(Date.parse(d) + 86400000).toISOString().slice(0, 10);

r.get("/compliance", wrap(async (req, res) => {
  gate(req);
  const f = await facts();
  const today = istDate();
  const tasks = await db.select().from(A.complianceTasks);
  const done = new Map(tasks.map((t) => [`${t.itemKey}|${t.period}`, t]));
  const items = ITEMS.map((it) => {
    const a = it.applies(f);
    const base = { key: it.key, title: it.title, category: it.category, law: it.law, frequency: it.frequency, dueText: it.dueText, form: it.form ?? null, portal: it.portal ?? null, template: it.template ?? null, need: a.need, why: a.why };
    if (a.need === "Not applicable") return { ...base, status: "Not applicable", due: null, period: null, last: null };
    const last = tasks.filter((t) => t.itemKey === it.key).sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1))[0] ?? null;
    const lastInfo = last ? { period: last.period, status: last.status, doneOn: last.doneOn, note: last.note, by: last.by } : null;
    if (it.frequency === "On event") return { ...base, status: "On event", due: null, period: null, last: lastInfo };
    if (it.frequency === "Ongoing") { const period = today.slice(0, 4); return { ...base, status: done.has(`${it.key}|${period}`) ? "Done" : "Ongoing", due: null, period, last: lastInfo }; }
    if (!it.due) { const period = "once"; return { ...base, status: done.has(`${it.key}|once`) ? "Done" : "To do", due: null, period, last: lastInfo }; }
    // A due date in the last 45 days that nobody has marked is shown as overdue first.
    const prev = prevDue(it, today);
    if (prev && days(prev, today) <= 45 && !done.has(`${it.key}|${periodOf(it, prev)}`)) return { ...base, status: "Overdue", due: prev, period: periodOf(it, prev), last: lastInfo };
    let due = nextDue(it, today);
    for (let k = 0; k < 4 && due && done.has(`${it.key}|${periodOf(it, due)}`); k++) due = nextDue(it, addDay(due));
    if (!due) return { ...base, status: done.has(`${it.key}|${periodOf(it, null)}`) ? "Done" : "To do", due: null, period: periodOf(it, null), last: lastInfo };
    const inDays = days(today, due);
    return { ...base, status: inDays < 0 ? "Overdue" : inDays <= 30 ? "Due in 30 days" : "Upcoming", due, period: periodOf(it, due), last: lastInfo };
  });
  await logAudit(req.actor!.email, "compliance.view");
  res.json({ today, facts: f, items, options: { industries: INDUSTRIES, turnoverBands: TURNOVER_BANDS, states: INDIAN_STATES } });
}));

const profileSchema = z.object({
  entity: z.enum(["private_limited", "llp", "opc"]), industry: z.string().min(2).max(60), turnoverBand: z.enum(Object.keys(TURNOVER_BANDS) as [CompanyFacts["turnoverBand"], ...CompanyFacts["turnoverBand"][]]),
  gstRegistered: z.boolean(), dpiit: z.boolean(), foreignInvestment: z.boolean(), msme: z.boolean(), msmeVendors: z.boolean(),
  incorporatedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), extraStates: z.array(z.enum(INDIAN_STATES)).max(36),
}).strict();
r.put("/compliance/profile", wrap(async (req, res) => {
  gate(req);
  const b = parse(profileSchema, req.body);
  await db.insert(A.complianceProfile).values({ settings: b, updatedBy: req.actor!.email });
  await logAudit(req.actor!.email, "compliance.profile.update");
  res.json(b);
}));

const markSchema = z.object({ period: z.string().min(4).max(10), status: z.enum(["done", "na"]).optional(), doneOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), note: z.string().max(500).optional() }).strict();
r.post("/compliance/:key/done", wrap(async (req, res) => {
  gate(req);
  const key = String(req.params.key);
  if (!ITEMS.some((i) => i.key === key)) throw new HttpError(404, "Unknown compliance item");
  const b = parse(markSchema, req.body);
  await db.insert(A.complianceTasks).values({ itemKey: key, period: b.period, status: b.status ?? "done", doneOn: b.doneOn ?? istDate(), note: b.note ?? null, by: req.actor!.email })
    .onConflictDoUpdate({ target: [A.complianceTasks.itemKey, A.complianceTasks.period], set: { status: b.status ?? "done", doneOn: b.doneOn ?? istDate(), note: b.note ?? null, by: req.actor!.email } });
  await logAudit(req.actor!.email, "compliance.done", "compliance", key, { period: b.period, status: b.status ?? "done" });
  res.json({ ok: true });
}));
r.post("/compliance/:key/undo", wrap(async (req, res) => {
  gate(req);
  const b = parse(z.object({ period: z.string().min(4).max(10) }).strict(), req.body);
  await db.delete(A.complianceTasks).where(and(eq(A.complianceTasks.itemKey, String(req.params.key)), eq(A.complianceTasks.period, b.period)));
  await logAudit(req.actor!.email, "compliance.undo", "compliance", String(req.params.key), { period: b.period });
  res.json({ ok: true });
}));
r.get("/compliance/history", wrap(async (req, res) => {
  gate(req);
  const rows = await db.select().from(A.complianceTasks).where(ne(A.complianceTasks.period, "")).orderBy(desc(A.complianceTasks.createdAt)).limit(500);
  const title = new Map(ITEMS.map((i) => [i.key, i.title]));
  res.json(rows.map((t) => ({ ...t, title: title.get(t.itemKey) ?? t.itemKey })));
}));

r.get("/compliance/templates/:key", wrap(async (req, res) => {
  gate(req);
  const [row] = await db.select().from(A.companyProfile).orderBy(desc(A.companyProfile.id)).limit(1);
  const co = { ...COMPANY_DEFAULTS, ...((row?.settings ?? {}) as Partial<CompanyProfile>) };
  const c = await counts();
  const html = renderComplianceTemplate(String(req.params.key), co, { year: String(Number(istDate().slice(0, 4)) - (istDate().slice(5, 7) === "01" ? 1 : 0)), ...c });
  if (!html) throw new HttpError(404, "No template for this item");
  res.type("html").send(html);
}));

export default r;
