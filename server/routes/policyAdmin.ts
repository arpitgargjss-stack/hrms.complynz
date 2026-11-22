import { Router } from "express";
import { z } from "zod";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { db, schema } from "../db";
import { wrap, parse, HttpError } from "./util";
import { logAudit } from "../lib/audit";
import { digest } from "../lib/auditTrim";
import { need } from "../lib/routeHelpers";
import { sanitizeHtml } from "../lib/sanitizeHtml";
import { saveFile } from "../lib/files";
import { placeholderValues } from "../lib/policyValues";
import { PLACEHOLDERS, POLICY_STATUS_LABEL, canPublishRender, changedSince, nextPolicyStatus, placeholdersIn, renderTemplate, type PolicyAction, type PolicyStatus, type Values } from "../../shared/hr/placeholders";
import { STARTER_TEMPLATES } from "../../shared/hr/policyTemplates";
import { diffPolicies } from "../../shared/hr/policyDiff";
import { convertLegacyHtml, legacyBlanks } from "../../shared/hr/legacyPolicy";
import { emailTemplateDef, fillEmail } from "../../shared/hr/emailTemplates";
import { textPlaceholderValues } from "../lib/policyValues";
import { detailUpdates, renderLive, templateOf } from "../lib/policyRender";
import { sendEmail } from "../lib/email";
import { env } from "../env";

/**
 * Admin configuration, phase 2: policies as templates with placeholders, CEO approval and frozen published versions.
 * HR admin and finance admin draft, submit and publish (settings.manage); only the CEO (super admin) approves or sends back.
 */
const r = Router();
const A = schema;
type Req = Parameters<typeof need>[0];
const gate = (req: Req) => need(req, "settings.manage", "all");
const who = (req: Req) => ({ ceo: req.actor!.roles.has("super_admin"), editor: req.actor!.roles.has("hr_admin") || req.actor!.roles.has("finance_signatory") });
const slugField = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,78}$/, "slug: lowercase letters, digits, hyphens");
const OPEN: PolicyStatus[] = ["draft", "pending_approval", "approved"];
type Ver = typeof A.policyVersions.$inferSelect;

async function bySlug(slug: string) {
  const [p] = await db.select().from(A.policies).where(eq(A.policies.slug, slug)).limit(1);
  if (!p) throw new HttpError(404, "No such policy");
  return p;
}
async function versionsOf(policyId: string) { return db.select().from(A.policyVersions).where(eq(A.policyVersions.policyId, policyId)).orderBy(desc(A.policyVersions.version)); }
const openDraft = (vs: Ver[]) => vs.find((v) => OPEN.includes(v.status as PolicyStatus)) ?? null;
const published = (vs: Ver[], current: number) => vs.find((v) => v.version === current && v.status === "published") ?? null;
const verOut = (v: Ver) => ({ id: v.id, version: v.version, status: v.status, statusLabel: POLICY_STATUS_LABEL[v.status as PolicyStatus] ?? v.status, summary: v.summary, createdBy: v.createdBy ?? v.publishedBy,
  createdAt: v.createdAt, submittedBy: v.submittedBy, submittedAt: v.submittedAt, approvedBy: v.approvedBy, approvedAt: v.approvedAt, reviewNote: v.reviewNote,
  publishedBy: v.status === "published" ? v.publishedBy : null, publishedAt: v.publishedAt ?? (v.status === "published" ? v.createdAt : null), fileId: v.fileId, hasTemplate: !!v.template });
/** Placeholders a version depends on: from its frozen values when published, else from its template. */
const usesOf = (v: Ver) => (v.fileId ? [] : placeholdersIn(templateOf(v)));

r.get("/config/policies", wrap(async (req, res) => {
  gate(req);
  const [pols, vers, acks, emps, values] = await Promise.all([
    db.select().from(A.policies).orderBy(asc(A.policies.title)), db.select().from(A.policyVersions), db.select().from(A.policyAcks),
    db.select({ id: A.employees.id }).from(A.employees).where(ne(A.employees.status, "exited")), placeholderValues(),
  ]);
  res.json({ ceo: who(req).ceo, starters: STARTER_TEMPLATES.map(({ html: _h, ...s }) => s), policies: pols.map((p) => {
    const vs = vers.filter((v) => v.policyId === p.id).sort((a, b) => b.version - a.version);
    const pub = published(vs, p.currentVersion), draft = openDraft(vs);
    const acked = new Set(acks.filter((a) => a.policyId === p.id && a.version === p.currentVersion).map((a) => a.employeeId));
    return { slug: p.slug, title: p.title, category: p.category, kind: p.kind, version: pub ? p.currentVersion : null,
      publishedAt: pub ? (pub.publishedAt ?? pub.createdAt) : null, draft: draft ? verOut(draft) : null,
      acks: pub ? { done: emps.filter((e) => acked.has(e.id)).length, total: emps.length } : null,
      // Values are filled in live; this only says which details changed since publishing (no re-publish needed).
      updatedSince: pub && !pub.fileId ? (pub.values ? changedSince(pub.values as Values, values) : []) : [], missing: pub && !pub.fileId ? renderLive(pub, values).missing : [], blanks: pub && !pub.fileId ? legacyBlanks(templateOf(pub)).length : 0 };
  }) });
}));

r.get("/config/policies/:slug", wrap(async (req, res) => {
  gate(req);
  const p = await bySlug(parse(slugField, req.params.slug));
  const vs = await versionsOf(p.id);
  const draft = openDraft(vs), pub = published(vs, p.currentVersion);
  const values = await placeholderValues();
  const base = draft ?? pub;
  const preview = base && !base.fileId ? renderTemplate(templateOf(base), values) : null;
  const live = pub && !pub.fileId ? renderLive(pub, values) : null;
  const updates = pub && live ? await detailUpdates(live.used, pub.publishedAt ?? pub.createdAt) : [];
  res.json({ ceo: who(req).ceo, policy: { slug: p.slug, title: p.title, category: p.category, kind: p.kind, version: pub ? p.currentVersion : null },
    draft: draft ? { ...verOut(draft), template: draft.template } : null,
    published: pub ? { ...verOut(pub), html: live ? live.html : sanitizeHtml(pub.html), template: live ? templateOf(pub) : null, legacy: !!live?.legacy, missing: live?.missing ?? [], unknown: live?.unknown ?? [], blanks: live ? legacyBlanks(templateOf(pub)) : [],
      updatedSince: pub.values ? changedSince(pub.values as Values, values) : [], updates } : null,
    preview: preview && base && { html: sanitizeHtml(preview.html), missing: preview.missing, unknown: preview.unknown, blanks: legacyBlanks(templateOf(base)) },
    // A draft copied from an old policy may still hold [blanks] the converter can link; the editor offers to convert them.
    convertible: draft?.template ? convertLegacyHtml(draft.template).replaced.length : 0,
    history: vs.map(verOut) });
}));

r.get("/config/placeholders", wrap(async (req, res) => {
  gate(req);
  const [values, pols, vers] = await Promise.all([placeholderValues(), db.select().from(A.policies), db.select().from(A.policyVersions)]);
  const title = new Map(pols.map((p) => [p.id, p]));
  const live = vers.filter((v) => { const p = title.get(v.policyId); return p && ((v.status === "published" && v.version === p.currentVersion) || OPEN.includes(v.status as PolicyStatus)); });
  res.json(PLACEHOLDERS.map((d) => ({ ...d, value: values[d.key] ?? null,
    usedBy: [...new Set(live.filter((v) => usesOf(v).includes(d.key)).map((v) => title.get(v.policyId)!.title))] })));
}));

r.post("/config/policies/preview", wrap(async (req, res) => {
  gate(req);
  const b = parse(z.object({ template: z.string().max(400_000) }).strict(), req.body);
  const out = renderTemplate(b.template, await placeholderValues());
  res.json({ html: sanitizeHtml(out.html), missing: out.missing, unknown: out.unknown, used: out.used, blanks: legacyBlanks(b.template) });
}));

const createSchema = z.object({ slug: slugField, title: z.string().trim().min(2).max(200), category: z.string().trim().max(60).nullable().optional(), template: z.string().max(400_000).optional(), starter: z.string().optional() }).strict();
/** Starts a new policy, or a new draft version of an existing one (copying the published template). One open draft per policy. */
r.post("/config/policies", wrap(async (req, res) => {
  gate(req);
  if (!who(req).editor) throw new HttpError(403, "Only HR admin or finance admin can draft policies");
  const b = parse(createSchema, req.body);
  const starter = b.starter ? STARTER_TEMPLATES.find((s) => s.slug === b.starter) : undefined;
  if (b.starter && !starter) throw new HttpError(400, "Unknown starter template");
  const email = req.actor!.email;
  const out = await db.transaction(async (tx) => {
    let [p] = await tx.select().from(A.policies).where(eq(A.policies.slug, b.slug)).limit(1).for("update");
    if (!p) [p] = await tx.insert(A.policies).values({ slug: b.slug, title: b.title, category: b.category ?? starter?.category ?? null, kind: "html", currentVersion: 0 }).returning();
    const vs = await tx.select().from(A.policyVersions).where(eq(A.policyVersions.policyId, p.id)).orderBy(desc(A.policyVersions.version));
    if (openDraft(vs)) throw new HttpError(409, "This policy already has a draft in progress");
    const pub = published(vs, p.currentVersion);
    const template = b.template ?? starter?.html ?? (pub && !pub.fileId ? templateOf(pub) : "<h1>" + b.title + "</h1>\n<p></p>");
    const version = (vs[0]?.version ?? 0) + 1;
    const [v] = await tx.insert(A.policyVersions).values({ policyId: p.id, version, html: "", template, status: "draft", publishedBy: email, createdBy: email }).returning();
    if (p.kind !== "html") await tx.update(A.policies).set({ kind: "html" }).where(eq(A.policies.id, p.id));
    return { p, v };
  });
  await logAudit(email, "policy.draft.create", "policy", out.p.id, { slug: b.slug, version: out.v.version, starter: b.starter ?? null, title: b.title, templateSha256: digest(out.v.template) });
  res.status(201).json({ slug: b.slug, version: out.v.version });
}));

/** Uploads a PDF as a new draft version. PDFs are view and acknowledge only: no placeholders. */
r.post("/config/policies/pdf", wrap(async (req, res) => {
  gate(req);
  if (!who(req).editor) throw new HttpError(403, "Only HR admin or finance admin can upload policies");
  const b = parse(z.object({ slug: slugField, title: z.string().trim().min(2).max(200), category: z.string().trim().max(60).nullable().optional(), name: z.string().min(1).max(200), dataBase64: z.string().min(10).max(14_000_000) }).strict(), req.body);
  const buf = Buffer.from(b.dataBase64, "base64");
  if (buf.subarray(0, 5).toString() !== "%PDF-") throw new HttpError(400, "Only PDF files can be uploaded");
  const email = req.actor!.email;
  const f = await saveFile({ kind: "policy", buf, name: b.name, mime: "application/pdf", uploadedBy: email });
  const out = await db.transaction(async (tx) => {
    let [p] = await tx.select().from(A.policies).where(eq(A.policies.slug, b.slug)).limit(1).for("update");
    if (!p) [p] = await tx.insert(A.policies).values({ slug: b.slug, title: b.title, category: b.category ?? null, kind: "pdf", currentVersion: 0 }).returning();
    const vs = await tx.select().from(A.policyVersions).where(eq(A.policyVersions.policyId, p.id)).orderBy(desc(A.policyVersions.version));
    if (openDraft(vs)) throw new HttpError(409, "This policy already has a draft in progress");
    const [v] = await tx.insert(A.policyVersions).values({ policyId: p.id, version: (vs[0]?.version ?? 0) + 1, html: "", fileId: f.id, status: "draft", publishedBy: email, createdBy: email }).returning();
    await tx.update(A.policies).set({ kind: "pdf", title: b.title }).where(eq(A.policies.id, p.id));
    return { p, v };
  });
  await logAudit(email, "policy.draft.upload", "policy", out.p.id, { slug: b.slug, version: out.v.version, fileId: f.id, sizeBytes: f.sizeBytes });
  res.status(201).json({ slug: b.slug, version: out.v.version });
}));

r.put("/config/policies/:slug/draft", wrap(async (req, res) => {
  gate(req);
  const b = parse(z.object({ title: z.string().trim().min(2).max(200), category: z.string().trim().max(60).nullable(), template: z.string().max(400_000), summary: z.string().trim().max(500).nullable() }).strict(), req.body);
  const p = await bySlug(parse(slugField, req.params.slug));
  const draft = openDraft(await versionsOf(p.id));
  if (!draft) throw new HttpError(404, "No draft to edit; start a new version first");
  if (draft.fileId) throw new HttpError(400, "A PDF policy cannot be edited here; upload a new PDF instead");
  const next = nextPolicyStatus(draft.status as PolicyStatus, "edit", who(req));
  if (!next) throw new HttpError(403, "Not allowed");
  await db.update(A.policyVersions).set({ template: b.template, summary: b.summary, status: next, submittedBy: null, submittedAt: null, approvedBy: null, approvedAt: null }).where(eq(A.policyVersions.id, draft.id));
  await db.update(A.policies).set({ title: b.title, category: b.category }).where(eq(A.policies.id, p.id));
  await logAudit(req.actor!.email, "policy.draft.update", "policy", p.id, { slug: p.slug, version: draft.version, statusBefore: draft.status,
    // Names of changed fields and a hash of the text; the policy text itself is never logged.
    changed: [p.title !== b.title && "title", p.category !== b.category && "category", draft.summary !== b.summary && "summary", draft.template !== b.template && "text"].filter(Boolean),
    before: { title: p.title, category: p.category, templateSha256: digest(draft.template) }, after: { title: b.title, category: b.category, templateSha256: digest(b.template) } });
  res.json({ ok: true, status: next });
}));

// ---------------------------------------------------------------- acknowledgements and reminders
async function pendingFor(p: typeof A.policies.$inferSelect) {
  const [emps, acks, rems] = await Promise.all([
    db.select({ id: A.employees.id, name: A.employees.fullName, code: A.employees.code, email: A.employees.workEmail }).from(A.employees).where(ne(A.employees.status, "exited")).orderBy(asc(A.employees.fullName)),
    db.select().from(A.policyAcks).where(and(eq(A.policyAcks.policyId, p.id), eq(A.policyAcks.version, p.currentVersion))),
    db.select().from(A.policyReminders).where(and(eq(A.policyReminders.policyId, p.id), eq(A.policyReminders.version, p.currentVersion))).orderBy(desc(A.policyReminders.createdAt)),
  ]);
  const done = new Set(acks.map((a) => a.employeeId));
  return { total: emps.length, done: done.size, pending: emps.filter((e) => !done.has(e.id)).map((e) => {
    const r = rems.filter((x) => x.employeeId === e.id);
    return { id: e.id, name: e.name, code: e.code, email: e.email, reminders: r.length, lastRemindedAt: r[0]?.createdAt ?? null };
  }) };
}
r.get("/config/policies/:slug/acks", wrap(async (req, res) => {
  gate(req);
  const p = await bySlug(parse(slugField, req.params.slug));
  if (p.currentVersion < 1) return res.json({ total: 0, done: 0, pending: [] });
  const out = await pendingFor(p);
  res.json({ ...out, pending: out.pending.map(({ email: _e, ...x }) => x) });
}));
/**
 * Reminds people who have not acknowledged the published version: an in-app notice on their Home page, and an email
 * only where a mail provider is configured and the app is not a local preview (dev sign-in).
 */
r.post("/config/policies/:slug/remind", wrap(async (req, res) => {
  gate(req);
  if (!who(req).editor) throw new HttpError(403, "Only HR admin or finance admin can send reminders");
  const b = parse(z.object({ employeeIds: z.array(z.string().uuid()).max(2000).optional() }).strict(), req.body ?? {});
  const p = await bySlug(parse(slugField, req.params.slug));
  if (p.currentVersion < 1) throw new HttpError(409, "Publish the policy first");
  const { pending } = await pendingFor(p);
  const targets = b.employeeIds ? pending.filter((e) => b.employeeIds!.includes(e.id)) : pending;
  if (!targets.length) return res.json({ reminded: 0, emailed: 0 });
  const canEmail = !!env.RESEND_API_KEY && env.AUTH_MODE !== "dev";
  let emailed = 0;
  if (canEmail) {
    const def = emailTemplateDef("policy_reminder")!;
    const [row] = await db.select().from(A.emailTemplates).where(eq(A.emailTemplates.key, def.key)).limit(1);
    const base = await textPlaceholderValues();
    for (const e of targets) {
      const vars = { ...base, name: e.name, policy: p.title, link: `${env.HR_APP_URL.replace(/\/$/, "")}/policies/${p.slug}` };
      if (await sendEmail({ to: e.email, subject: fillEmail(row?.subject ?? def.subject, vars), text: fillEmail(row?.body ?? def.body, vars) })) emailed++;
    }
  }
  await db.insert(A.policyReminders).values(targets.map((e) => ({ policyId: p.id, version: p.currentVersion, employeeId: e.id, sentBy: req.actor!.email, emailed: canEmail })));
  await logAudit(req.actor!.email, "policy.remind", "policy", p.id, { slug: p.slug, version: p.currentVersion, reminded: targets.length, emailed, perPerson: !!b.employeeIds });
  res.json({ reminded: targets.length, emailed, emailAvailable: canEmail });
}));
/** The current person's reminders for policies they still have to acknowledge, for the Home page. */
r.get("/policies/reminders/mine", wrap(async (req, res) => {
  const empId = req.actor!.employeeId;
  if (!empId) return res.json([]);
  const [rems, pols, acks] = await Promise.all([
    db.select().from(A.policyReminders).where(eq(A.policyReminders.employeeId, empId)).orderBy(desc(A.policyReminders.createdAt)),
    db.select().from(A.policies), db.select().from(A.policyAcks).where(eq(A.policyAcks.employeeId, empId)),
  ]);
  const out = pols.filter((p) => p.currentVersion > 0 && rems.some((r) => r.policyId === p.id && r.version === p.currentVersion) && !acks.some((a) => a.policyId === p.id && a.version === p.currentVersion))
    .map((p) => ({ slug: p.slug, title: p.title, version: p.currentVersion, remindedAt: rems.find((r) => r.policyId === p.id)!.createdAt }));
  res.json(out);
}));

/** Compares the rendered text of two versions; a draft is rendered with today's values. */
r.get("/config/policies/:slug/compare", wrap(async (req, res) => {
  gate(req);
  const q = parse(z.object({ from: z.coerce.number().int().min(1), to: z.coerce.number().int().min(1) }), req.query);
  const p = await bySlug(parse(slugField, req.params.slug));
  const vs = await versionsOf(p.id);
  const values = await placeholderValues();
  const text = (n: number) => { const v = vs.find((x) => x.version === n); if (!v) throw new HttpError(404, `No version ${n}`);
    if (v.fileId) throw new HttpError(400, "PDF versions cannot be compared"); return renderTemplate(templateOf(v), values).html; }; // same values on both sides, so only wording differences show
  const ops = diffPolicies(text(q.from), text(q.to));
  res.json({ from: q.from, to: q.to, ops, added: ops.filter((o) => o.op === "add").length, removed: ops.filter((o) => o.op === "del").length });
}));

/** Moves the open draft through the approval flow. Submit and publish need every placeholder filled. */
r.post("/config/policies/:slug/:action", wrap(async (req, res) => {
  gate(req);
  const action = String(req.params.action) as PolicyAction | "discard";
  if (!["submit", "approve", "return", "publish", "discard"].includes(action)) throw new HttpError(404, "Unknown action");
  const b = parse(z.object({ note: z.string().trim().max(1000).optional() }).strict(), req.body ?? {});
  const p = await bySlug(parse(slugField, req.params.slug));
  const vs = await versionsOf(p.id);
  const draft = openDraft(vs);
  if (!draft) throw new HttpError(404, "No draft in progress");
  const email = req.actor!.email;
  if (action === "discard") {
    if (!who(req).editor && !who(req).ceo) throw new HttpError(403, "Not allowed");
    await db.delete(A.policyVersions).where(eq(A.policyVersions.id, draft.id));
    await logAudit(email, "policy.draft.discard", "policy", p.id, { slug: p.slug, version: draft.version, before: { status: draft.status, templateSha256: digest(draft.template) } });
    return res.json({ ok: true });
  }
  const next = nextPolicyStatus(draft.status as PolicyStatus, action, who(req));
  if (!next) throw new HttpError(action === "approve" || action === "return" ? 403 : 409,
    action === "approve" || action === "return" ? "Only the CEO (super admin) can approve or send back a policy" : `Cannot ${action} a policy that is ${POLICY_STATUS_LABEL[draft.status as PolicyStatus]?.toLowerCase() ?? draft.status}`);
  if (action === "return" && !b.note) throw new HttpError(400, "Add a note saying what to change");
  const values = await placeholderValues();
  const rendered = draft.template ? renderTemplate(draft.template, values) : null;
  if ((action === "submit" || action === "publish") && rendered && !canPublishRender(rendered))
    throw new HttpError(422, `Fill these in Configuration first: ${[...rendered.missing, ...rendered.unknown.map((k) => `${k} (unknown placeholder)`)].join(", ")}`);
  const left = draft.template ? legacyBlanks(draft.template) : [];
  if ((action === "submit" || action === "publish") && left.length)
    throw new HttpError(422, `Link or edit these blanks first: ${left.map((b) => `[${b}]`).join(", ")}`);
  const now = new Date();
  const patch: Partial<Ver> =
    action === "submit" ? { status: next, submittedBy: email, submittedAt: now, reviewNote: null }
    : action === "approve" ? { status: next, approvedBy: email, approvedAt: now, reviewNote: b.note ?? null }
    : action === "return" ? { status: next, reviewNote: b.note!, approvedBy: null, approvedAt: null }
    : { status: next, html: rendered ? rendered.html : "", values: rendered ? rendered.snapshot : null, publishedBy: email, publishedAt: now };
  await db.transaction(async (tx) => {
    await tx.update(A.policyVersions).set(patch).where(and(eq(A.policyVersions.id, draft.id), eq(A.policyVersions.status, draft.status)));
    if (action === "publish") await tx.update(A.policies).set({ currentVersion: draft.version }).where(eq(A.policies.id, p.id));
  });
  await logAudit(email, `policy.${action}`, "policy", p.id, { slug: p.slug, version: draft.version, before: { status: draft.status, currentVersion: p.currentVersion },
    after: { status: next, currentVersion: action === "publish" ? draft.version : p.currentVersion }, note: b.note ?? null, ...(action === "publish" ? { templateSha256: digest(draft.template), valuesSha256: digest(rendered?.snapshot ?? null) } : {}) });
  res.json({ ok: true, status: next });
}));

export default r;
