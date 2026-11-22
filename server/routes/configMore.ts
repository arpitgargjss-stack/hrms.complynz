import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { db, schema } from "../db";
import { wrap, parse, HttpError } from "./util";
import { logAudit } from "../lib/audit";
import { need, istDate, idParam } from "../lib/routeHelpers";
import { DEFAULT_CHECKLIST, nextChecklistVersion, validateChecklist, type Checklist, type ChecklistItem, type LinkChecklist } from "../../shared/hr/onboardingChecklist";
import { EMAIL_TEMPLATES, emailTemplateDef, unknownEmailPlaceholders } from "../../shared/hr/emailTemplates";

/**
 * Admin configuration, phases 3 to 5: the status summary for Overview, the versioned onboarding checklist,
 * and the email template editor. Pay and time-off settings reuse their existing endpoints.
 */
const r = Router();
const A = schema;
type Req = Parameters<typeof need>[0];
const gate = (req: Req) => need(req, "settings.manage", "all");
const hrOnly = (req: Req) => { gate(req); if (!req.actor!.roles.has("hr_admin")) throw new HttpError(403, "Only HR admin can change this"); };

export async function currentChecklist(): Promise<Checklist & { updatedBy: string | null; updatedAt: Date | null }> {
  const [row] = await db.select().from(A.onboardingChecklist).orderBy(desc(A.onboardingChecklist.id)).limit(1);
  return row ? { version: row.version, items: row.items as ChecklistItem[], updatedBy: row.updatedBy, updatedAt: row.createdAt } : { ...DEFAULT_CHECKLIST, updatedBy: null, updatedAt: null };
}
const publishedPolicies = async () => (await db.select({ slug: A.policies.slug, title: A.policies.title, v: A.policies.currentVersion }).from(A.policies)).filter((p) => p.v > 0);

/** One line of status per Configuration section, for the Overview tab. */
r.get("/config/summary", wrap(async (req, res) => {
  gate(req);
  const year = istDate().slice(0, 4);
  const [[rule], templates, [reimb], [fnf], leave, holidays, checklist, emails, pols, vers] = await Promise.all([
    db.select({ from: A.statutoryRules.effectiveFrom }).from(A.statutoryRules).where(lte(A.statutoryRules.effectiveFrom, istDate())).orderBy(desc(A.statutoryRules.effectiveFrom)).limit(1),
    db.select({ id: A.salaryTemplates.id }).from(A.salaryTemplates),
    db.select({ id: A.reimbursementPolicy.id }).from(A.reimbursementPolicy).limit(1),
    db.select({ id: A.fnfRules.id }).from(A.fnfRules).limit(1),
    db.select({ id: A.leaveTypes.id }).from(A.leaveTypes).where(eq(A.leaveTypes.active, true)),
    db.select({ id: A.holidays.id }).from(A.holidays).where(and(gte(A.holidays.date, `${year}-01-01`), lte(A.holidays.date, `${year}-12-31`))),
    currentChecklist(), db.select({ key: A.emailTemplates.key }).from(A.emailTemplates),
    db.select().from(A.policies), db.select({ policyId: A.policyVersions.policyId, status: A.policyVersions.status }).from(A.policyVersions).where(ne(A.policyVersions.status, "published")),
  ]);
  res.json({
    pay: { rulesFrom: rule?.from ?? null, salaryTemplates: templates.length, reimbursementSet: !!reimb, fnfSet: !!fnf },
    time: { leaveTypes: leave.length, holidaysThisYear: holidays.length, year },
    onboarding: { version: checklist.version, items: checklist.items.length },
    templates: { total: EMAIL_TEMPLATES.length, customised: emails.filter((e) => EMAIL_TEMPLATES.some((t) => t.key === e.key)).length },
    policies: { published: pols.filter((p) => p.currentVersion > 0).length, waiting: vers.filter((v) => v.status === "pending_approval").length, drafts: vers.length },
    canEditTime: req.actor!.roles.has("hr_admin"), canEditHr: req.actor!.roles.has("hr_admin"),
  });
}));

// ---------------------------------------------------------------- onboarding checklist
r.get("/config/onboarding", wrap(async (req, res) => {
  gate(req);
  const [cur, history, policies] = await Promise.all([
    currentChecklist(),
    db.select({ version: A.onboardingChecklist.version, by: A.onboardingChecklist.updatedBy, at: A.onboardingChecklist.createdAt, items: A.onboardingChecklist.items }).from(A.onboardingChecklist).orderBy(desc(A.onboardingChecklist.id)).limit(20),
    publishedPolicies(),
  ]);
  res.json({ current: cur, history: history.map((h) => ({ version: h.version, by: h.by, at: h.at, count: (h.items as unknown[]).length })), policies: policies.map((p) => ({ slug: p.slug, title: p.title })), canEdit: req.actor!.roles.has("hr_admin") });
}));
const itemSchema = z.object({ id: z.string().trim().min(1).max(60), kind: z.enum(["candidate_step", "document", "nda", "policy_ack", "asset", "custom"]), label: z.string().trim().min(1).max(160), key: z.string().trim().max(80).nullable(), required: z.boolean() }).strict();
r.put("/config/onboarding", wrap(async (req, res) => {
  hrOnly(req);
  const b = parse(z.object({ items: z.array(itemSchema).min(1).max(60) }).strict(), req.body);
  const problems = validateChecklist(b.items, (await publishedPolicies()).map((p) => p.slug));
  if (problems.length) throw new HttpError(422, problems.join("; "));
  const before = await currentChecklist();
  const version = nextChecklistVersion(before, b.items);
  if (version === before.version && before.updatedBy) return res.json({ version, changed: false });
  await db.insert(A.onboardingChecklist).values({ version: Math.max(version, 1), items: b.items, updatedBy: req.actor!.email });
  await logAudit(req.actor!.email, "config.onboarding_checklist.update", "onboarding_checklist", String(Math.max(version, 1)), { before: { version: before.version, items: before.items }, after: { version: Math.max(version, 1), items: b.items } });
  res.json({ version: Math.max(version, 1), changed: true });
}));
/** HR ticks an item on one onboarding link's own copy of the checklist. */
r.patch("/onboarding-links/:id/checklist/:itemId", wrap(async (req, res) => {
  need(req, "hiring.manage", "all");
  const b = parse(z.object({ done: z.boolean() }).strict(), req.body);
  const [link] = await db.select().from(A.onboardingLinks).where(eq(A.onboardingLinks.id, idParam(req))).limit(1);
  if (!link?.checklist) throw new HttpError(404, "This link has no checklist");
  const c = link.checklist as LinkChecklist, itemId = String(req.params.itemId);
  const item = c.items.find((i) => i.id === itemId);
  if (!item) throw new HttpError(404, "No such item");
  const before = { done: item.done, doneBy: item.doneBy };
  Object.assign(item, b.done ? { done: true, doneBy: req.actor!.email, doneAt: new Date().toISOString() } : { done: false, doneBy: null, doneAt: null });
  await db.update(A.onboardingLinks).set({ checklist: c }).where(eq(A.onboardingLinks.id, link.id));
  await logAudit(req.actor!.email, "onboarding.checklist.tick", "onboarding_link", link.id, { itemId, before, after: { done: item.done, doneBy: item.doneBy } });
  res.json(c);
}));

// ---------------------------------------------------------------- email templates
r.get("/config/email-templates", wrap(async (req, res) => {
  gate(req);
  const rows = await db.select().from(A.emailTemplates).where(inArray(A.emailTemplates.key, EMAIL_TEMPLATES.map((t) => t.key)));
  res.json({ canEdit: req.actor!.roles.has("hr_admin"), templates: EMAIL_TEMPLATES.map((t) => { const row = rows.find((x) => x.key === t.key);
    return { key: t.key, label: t.label, when: t.when, vars: t.vars, subject: row?.subject ?? t.subject, body: row?.body ?? t.body, customised: !!row, updatedAt: row?.updatedAt ?? null, defaultSubject: t.subject, defaultBody: t.body }; }) });
}));
r.put("/config/email-templates/:key", wrap(async (req, res) => {
  hrOnly(req);
  const def = emailTemplateDef(String(req.params.key));
  if (!def) throw new HttpError(404, "Unknown email template");
  const b = parse(z.object({ subject: z.string().trim().min(2).max(200), body: z.string().trim().min(2).max(10_000) }).strict(), req.body);
  const unknown = unknownEmailPlaceholders(def, b.subject, b.body);
  if (unknown.length) throw new HttpError(422, `Unknown placeholders: ${unknown.map((k) => `{{${k}}}`).join(", ")}`);
  const [before] = await db.select().from(A.emailTemplates).where(eq(A.emailTemplates.key, def.key)).limit(1);
  await db.insert(A.emailTemplates).values({ key: def.key, ...b }).onConflictDoUpdate({ target: A.emailTemplates.key, set: { ...b, updatedAt: new Date() } });
  await logAudit(req.actor!.email, "config.email_template.update", "email_template", def.key, { before: before ? { subject: before.subject, body: before.body } : { subject: def.subject, body: def.body, default: true }, after: b });
  res.json({ ok: true });
}));
r.delete("/config/email-templates/:key", wrap(async (req, res) => {
  hrOnly(req);
  const def = emailTemplateDef(String(req.params.key));
  if (!def) throw new HttpError(404, "Unknown email template");
  const [before] = await db.delete(A.emailTemplates).where(eq(A.emailTemplates.key, def.key)).returning();
  await logAudit(req.actor!.email, "config.email_template.reset", "email_template", def.key, { before: before ? { subject: before.subject, body: before.body } : null, after: { subject: def.subject, body: def.body, default: true } });
  res.json({ ok: true });
}));

export default r;
