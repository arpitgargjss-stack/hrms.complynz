import { Router, type Request } from "express";
import { z } from "zod";
import { and, asc, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { db, schema as S } from "../db";
import { wrap, parse, HttpError } from "./util";
import { logAudit } from "../lib/audit";
import { saveFile } from "../lib/files";
import { sendConsentEvent } from "../lib/consentClient";
import { subjectOf, personOf, visibleSections, vibeGrants, pageGranted, sectionLabel, type Person } from "../lib/vibe";
import {
  VIBE_SECTIONS, VIBE_SECTION_KEYS, AUDIENCES, isVibeSection, VIBE_PURPOSE, consentInput, consentProblem, commonTags, sameTeam, receiptNo,
  FEED_PURPOSE, FEED_KIND_LABEL, REACTIONS, feedPostInput, linkHost, type Audience, type VibeSectionKey, type FeedKind,
} from "../../shared/hr/vibe";
import { CONSENT_PURPOSES } from "../../shared/hr/misc";
import { PROFILE_ACKNOWLEDGEMENTS } from "../../shared/hr/profile";
import { toXlsx } from "../lib/xlsx";

const r = Router();
const uuid = z.string().uuid();

function selfId(req: Request): string {
  const id = req.actor?.employeeId;
  if (!id) throw new HttpError(404, "No employee record is linked to this login");
  return id;
}
async function viewerOf(req: Request): Promise<Person> {
  const p = await personOf(selfId(req));
  if (!p) throw new HttpError(404, "No employee record is linked to this login");
  return p;
}
const isHr = (req: Request) => !!req.actor?.roles.has("hr_admin");

async function lookups() {
  const [d, g, l] = await Promise.all([db.select().from(S.departments), db.select().from(S.designations), db.select().from(S.locations)]);
  return { dept: new Map(d.map((x) => [x.id, x.name])), desig: new Map(g.map((x) => [x.id, x.name])), loc: new Map(l.map((x) => [x.id, x.name])) };
}
type Emp = typeof S.employees.$inferSelect;
type L = Awaited<ReturnType<typeof lookups>>;
/** Work-card fields only: everyone with a staff login already sees these in the directory. */
const cardOf = (e: Emp, L: L) => ({
  id: e.id, fullName: e.fullName, photoFileId: e.photoFileId, designation: e.designationId ? L.desig.get(e.designationId) ?? null : null,
  department: e.departmentId ? L.dept.get(e.departmentId) ?? null : null, location: e.locationId ? L.loc.get(e.locationId) ?? null : null,
  joiningDate: e.joiningDate,
});
const tagsOf = (secs: { key: string; content: unknown }[]) => ((secs.find((s) => s.key === "interests")?.content as { tags?: string[] } | undefined)?.tags ?? []);

/** Append a consent event (the existing ledger) and mirror it to the CMP. */
async function recordConsent(tx: typeof db, employeeId: string, purposeKey: string, status: "granted" | "withdrawn", noticeVersion: string, detail: Record<string, unknown>) {
  const [ev] = await tx.insert(S.consentEvents).values({ subjectId: subjectOf(employeeId), purposeKey, status, noticeVersion, source: "hr_app", detail }).returning();
  return ev;
}
const mirror = (ev: { subjectId: string; purposeKey: string; status: string; noticeVersion: string }) =>
  sendConsentEvent({ subjectId: ev.subjectId, purposeKey: ev.purposeKey, status: ev.status as "granted" | "withdrawn", noticeVersion: ev.noticeVersion });

// =====================================================================
// Vibe pages
// =====================================================================
r.get("/vibe/me", wrap(async (req, res) => {
  const me = selfId(req);
  const rows = await db.select().from(S.vibeSections).where(eq(S.vibeSections.employeeId, me));
  const page = (await vibeGrants([me])).get(me);
  res.json(VIBE_SECTION_KEYS.map((key) => {
    const row = rows.find((x) => x.sectionKey === key);
    return { key, label: VIBE_SECTIONS[key].label, hint: VIBE_SECTIONS[key].hint, others: VIBE_SECTIONS[key].others,
      content: row?.content ?? null, audience: (row?.audience ?? "only_me") as Audience, consent: page?.status ?? "not_set", updatedAt: row?.updatedAt ?? null };
  }));
}));

r.get("/vibe/:id", wrap(async (req, res) => {
  const viewer = await viewerOf(req);
  const id = parse(uuid, req.params.id);
  const [e] = await db.select().from(S.employees).where(eq(S.employees.id, id)).limit(1);
  if (!e || (e.status === "exited" && e.id !== viewer.id)) throw new HttpError(404, "Not found");
  const L = await lookups();
  const vis = await visibleSections(viewer, [e]);
  const sections = vis.get(id) ?? [];
  const mine = id === viewer.id ? sections : (await visibleSections(viewer, [viewer])).get(viewer.id) ?? [];
  const mgr = e.managerId ? (await db.select({ id: S.employees.id, fullName: S.employees.fullName }).from(S.employees).where(eq(S.employees.id, e.managerId)).limit(1))[0] ?? null : null;
  const teamRows = await db.select().from(S.employees).where(and(ne(S.employees.status, "exited"), ne(S.employees.id, id),
    e.departmentId ? or(eq(S.employees.departmentId, e.departmentId), eq(S.employees.managerId, id)) : eq(S.employees.managerId, id))).orderBy(asc(S.employees.fullName)).limit(12);
  const posts = await visiblePosts(viewer, { authorId: id, limit: 3 });
  res.json({
    person: { ...cardOf(e, L), manager: mgr, self: id === viewer.id, sameTeam: sameTeam(viewer, e) },
    sections: Object.fromEntries(sections.map((s) => [s.key, { content: s.content, audience: s.audience }])),
    common: id === viewer.id ? [] : commonTags(tagsOf(mine), tagsOf(sections)),
    team: teamRows.map((t) => ({ id: t.id, fullName: t.fullName, photoFileId: t.photoFileId })),
    recentPosts: posts,
  });
}));

const consentOut = (ev: typeof S.consentEvents.$inferSelect | undefined) =>
  ({ status: (ev?.status ?? "not_set") as "granted" | "withdrawn" | "not_set", at: ev?.at ?? null, noticeVersion: ev?.noticeVersion ?? null,
     receipt: ev?.status === "granted" ? receiptNo(ev.id, ev.at) : null });

/** One consent for the whole vibe page. */
r.get("/me/vibe/consent", wrap(async (req, res) => {
  const me = selfId(req);
  res.json(consentOut((await vibeGrants([me])).get(me)));
}));
r.post("/me/vibe/consent", wrap(async (req, res) => {
  const me = selfId(req);
  const b = parse(consentInput, req.body);
  const prev = (await vibeGrants([me])).get(me);
  if (pageGranted(prev)) return void res.json(consentOut(prev));
  const ev = await recordConsent(db, me, VIBE_PURPOSE, "granted", b.noticeVersion, { scope: "vibe_page", othersConfirmed: true });
  mirror(ev);
  res.status(201).json(consentOut(ev));
}));
/** Turning sharing off hides every card from everyone else at once. Cards keep their audience for when it's turned back on. */
async function withdrawPage(me: string) {
  const prev = (await vibeGrants([me])).get(me);
  if (!pageGranted(prev)) return consentOut(prev);
  const ev = await recordConsent(db, me, VIBE_PURPOSE, "withdrawn", prev!.noticeVersion, { scope: "vibe_page" });
  mirror(ev);
  return consentOut(ev);
}
r.post("/me/vibe/consent/withdraw", wrap(async (req, res) => { res.json(await withdrawPage(selfId(req))); }));
r.post("/me/vibe/hide-all", wrap(async (req, res) => { res.json({ ok: true, consent: await withdrawPage(selfId(req)) }); }));

const sectionBody = z.object({ content: z.unknown(), audience: z.enum(AUDIENCES), consent: consentInput.optional() }).strict();

r.put("/me/vibe/:section", wrap(async (req, res) => {
  const me = selfId(req);
  const key = String(req.params.section);
  if (!isVibeSection(key)) throw new HttpError(404, "Unknown section");
  const b = parse(sectionBody, req.body);
  const content = parse(VIBE_SECTIONS[key].schema as z.ZodType<unknown>, b.content);
  if (key === "snaps") {
    const ids = (content as { photos: { fileId: string }[] }).photos.map((p) => p.fileId);
    if (ids.length) {
      const owned = await db.select({ id: S.files.id }).from(S.files).where(and(inArray(S.files.id, ids), eq(S.files.ownerEmployeeId, me), eq(S.files.kind, "vibe_photo")));
      if (owned.length !== new Set(ids).size) throw new HttpError(400, "One of the photos is not yours");
    }
  }
  const prev = (await vibeGrants([me])).get(me);
  // The first share may carry the page consent; it is recorded once and then covers every card.
  const grantNow = !pageGranted(prev) && b.audience !== "only_me" && !!b.consent;
  const problem = consentProblem(b.audience, pageGranted(prev) || grantNow);
  if (problem) throw new HttpError(400, problem);
  const out = await db.transaction(async (tx) => {
    const ev = grantNow ? await recordConsent(tx as unknown as typeof db, me, VIBE_PURPOSE, "granted", b.consent!.noticeVersion, { scope: "vibe_page", othersConfirmed: true, firstCard: key }) : null;
    const page = ev ?? prev;
    const values = { employeeId: me, sectionKey: key, content: content as object, audience: b.audience, consentEventId: b.audience !== "only_me" && page ? page.id : null, updatedAt: new Date() };
    const [row] = await tx.insert(S.vibeSections).values(values)
      .onConflictDoUpdate({ target: [S.vibeSections.employeeId, S.vibeSections.sectionKey], set: { content: values.content, audience: values.audience, consentEventId: values.consentEventId, updatedAt: values.updatedAt } }).returning();
    return { row, ev };
  });
  if (out.ev) mirror(out.ev);
  res.json({ key, audience: out.row.audience, consent: out.ev ? consentOut(out.ev) : null });
}));

/** Per-card hide or delete only changes that card; the page consent is untouched. */
r.post("/me/vibe/:section/withdraw", wrap(async (req, res) => {
  const key = String(req.params.section);
  if (!isVibeSection(key)) throw new HttpError(404, "Unknown section");
  await db.update(S.vibeSections).set({ audience: "only_me", consentEventId: null, updatedAt: new Date() }).where(and(eq(S.vibeSections.employeeId, selfId(req)), eq(S.vibeSections.sectionKey, key)));
  res.json({ ok: true });
}));
r.delete("/me/vibe/:section", wrap(async (req, res) => {
  const key = String(req.params.section);
  if (!isVibeSection(key)) throw new HttpError(404, "Unknown section");
  await db.delete(S.vibeSections).where(and(eq(S.vibeSections.employeeId, selfId(req)), eq(S.vibeSections.sectionKey, key)));
  res.json({ ok: true });
}));

const MAGIC: Record<string, (b: Buffer) => boolean> = {
  "image/png": (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8,
  "image/webp": (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
};
r.post("/me/vibe/photos", wrap(async (req, res) => {
  const me = selfId(req);
  const b = parse(z.object({ name: z.string().trim().min(1).max(200), mime: z.enum(["image/png", "image/jpeg", "image/webp"]), dataBase64: z.string().min(8).max(8_000_000) }).strict(), req.body);
  const buf = Buffer.from(b.dataBase64.replace(/^data:[^,]*,/, ""), "base64");
  if (!buf.length || buf.length > 5 * 1024 * 1024) throw new HttpError(400, "Photos must be under 5 MB");
  if (!MAGIC[b.mime](buf)) throw new HttpError(400, "File content does not match the declared type");
  const f = await saveFile({ kind: "vibe_photo", buf, name: b.name, mime: b.mime, uploadedBy: req.actor!.email, ownerEmployeeId: me });
  res.status(201).json({ fileId: f.id });
}));

// =====================================================================
// Know your team
// =====================================================================
r.get("/team", wrap(async (req, res) => {
  const viewer = await viewerOf(req);
  const L = await lookups();
  const emps = await db.select().from(S.employees).where(ne(S.employees.status, "exited")).orderBy(asc(S.employees.fullName));
  const vis = await visibleSections(viewer, emps);
  const mine = tagsOf(vis.get(viewer.id) ?? []);
  const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  res.json({
    myTags: mine,
    people: emps.map((e) => {
      const secs = vis.get(e.id) ?? [];
      const others = e.id === viewer.id ? secs : secs.filter((s) => s.audience !== "only_me");
      const status = (others.find((s) => s.key === "status")?.content as { text?: string } | undefined)?.text;
      const bio = (others.find((s) => s.key === "bio")?.content as { text?: string } | undefined)?.text;
      const tags = tagsOf(others);
      return { ...cardOf(e, L), self: e.id === viewer.id, sameTeam: sameTeam(viewer, e), isNew: e.joiningDate >= monthAgo,
        shared: others.length > 0, fact: status || (bio ? bio.split(/(?<=[.!?])\s/)[0].slice(0, 140) : null), tags: tags.slice(0, 4),
        common: e.id === viewer.id ? [] : commonTags(mine, tags) };
    }),
  });
}));

// =====================================================================
// Team feed
// =====================================================================
type PostOut = {
  id: string; kind: FeedKind; kindLabel: string; audience: string; quote: string | null; source: string | null; url: string | null; host: string | null; title: string | null; note: string | null; createdAt: Date;
  author: { id: string; fullName: string; photoFileId: string | null }; counts: Record<string, number>; mine: string[]; canDelete: boolean;
};
async function visiblePosts(viewer: Person, opts: { tab?: "team" | "everyone" | "saved"; authorId?: string; limit?: number; hr?: boolean }): Promise<PostOut[]> {
  const conds = [isNull(S.feedPosts.deletedAt)];
  if (opts.authorId) conds.push(eq(S.feedPosts.employeeId, opts.authorId));
  if (opts.tab === "everyone") conds.push(eq(S.feedPosts.audience, "everyone"));
  if (opts.tab === "saved") {
    const saved = await db.select({ postId: S.feedReactions.postId }).from(S.feedReactions).where(and(eq(S.feedReactions.employeeId, viewer.id), eq(S.feedReactions.kind, "save")));
    if (!saved.length) return [];
    conds.push(inArray(S.feedPosts.id, saved.map((s) => s.postId)));
  }
  const rows = await db.select({ p: S.feedPosts, a: { id: S.employees.id, fullName: S.employees.fullName, photoFileId: S.employees.photoFileId, departmentId: S.employees.departmentId, managerId: S.employees.managerId, status: S.employees.status } })
    .from(S.feedPosts).innerJoin(S.employees, eq(S.employees.id, S.feedPosts.employeeId)).where(and(...conds)).orderBy(desc(S.feedPosts.createdAt)).limit(200);
  const seen = rows.filter(({ p, a }) => {
    if (a.status === "exited" && a.id !== viewer.id) return false;
    const teamOk = a.id === viewer.id || (!!p.departmentId && p.departmentId === viewer.departmentId) || sameTeam(viewer, a);
    if (p.audience === "team" && !teamOk) return false;
    if (opts.tab === "team" && !teamOk) return false;
    return true;
  }).slice(0, opts.limit ?? 50);
  const ids = seen.map((x) => x.p.id);
  const reacts = ids.length ? await db.select().from(S.feedReactions).where(inArray(S.feedReactions.postId, ids)) : [];
  return seen.map(({ p, a }) => {
    const rs = reacts.filter((x) => x.postId === p.id);
    const counts = Object.fromEntries(REACTIONS.map((k) => [k, rs.filter((x) => x.kind === k).length]));
    return { id: p.id, kind: p.kind as FeedKind, kindLabel: FEED_KIND_LABEL[p.kind as FeedKind] ?? p.kind, audience: p.audience, quote: p.quote, source: p.source, url: p.url, host: linkHost(p.url),
      title: p.title, note: p.note, createdAt: p.createdAt, author: { id: a.id, fullName: a.fullName, photoFileId: a.photoFileId }, counts,
      mine: rs.filter((x) => x.employeeId === viewer.id).map((x) => x.kind), canDelete: a.id === viewer.id || !!opts.hr };
  });
}

r.get("/feed", wrap(async (req, res) => {
  const viewer = await viewerOf(req);
  const tab = parse(z.enum(["team", "everyone", "saved"]).default("team"), req.query.tab);
  res.json(await visiblePosts(viewer, { tab, hr: isHr(req) }));
}));
r.get("/feed/top", wrap(async (req, res) => {
  const viewer = await viewerOf(req);
  const since = new Date(Date.now() - 7 * 86400_000);
  const posts = (await visiblePosts(viewer, { limit: 200 })).filter((p) => p.createdAt >= since && p.counts.save > 0);
  res.json(posts.sort((a, b) => b.counts.save - a.counts.save).slice(0, 3).map((p) => ({ id: p.id, title: p.title ?? (p.quote ? `“${p.quote.slice(0, 80)}”` : p.host), saves: p.counts.save })));
}));
r.post("/feed", wrap(async (req, res) => {
  const viewer = await viewerOf(req);
  const b = parse(feedPostInput, req.body);
  const [post] = await db.insert(S.feedPosts).values({
    employeeId: viewer.id, kind: b.kind, audience: b.audience, departmentId: viewer.departmentId,
    quote: b.kind === "quote" ? b.quote ?? null : null, source: b.source ?? null, url: b.kind === "quote" ? null : b.url ?? null, title: b.title ?? null, note: b.note ?? null,
  }).returning();
  res.status(201).json({ id: post.id });
}));
r.post("/feed/:id/react", wrap(async (req, res) => {
  const viewer = await viewerOf(req);
  const id = parse(uuid, req.params.id);
  const b = parse(z.object({ kind: z.enum(REACTIONS), on: z.boolean() }).strict(), req.body);
  const visible = (await visiblePosts(viewer, { limit: 200 })).some((p) => p.id === id);
  if (!visible) throw new HttpError(404, "Not found");
  if (b.on) await db.insert(S.feedReactions).values({ postId: id, employeeId: viewer.id, kind: b.kind }).onConflictDoNothing();
  else await db.delete(S.feedReactions).where(and(eq(S.feedReactions.postId, id), eq(S.feedReactions.employeeId, viewer.id), eq(S.feedReactions.kind, b.kind)));
  res.json({ ok: true });
}));
r.delete("/feed/:id", wrap(async (req, res) => {
  const viewer = await viewerOf(req);
  const id = parse(uuid, req.params.id);
  const [p] = await db.select().from(S.feedPosts).where(and(eq(S.feedPosts.id, id), isNull(S.feedPosts.deletedAt))).limit(1);
  if (!p) throw new HttpError(404, "Not found");
  const own = p.employeeId === viewer.id;
  if (!own && !isHr(req)) throw new HttpError(403, "Not allowed");
  await db.update(S.feedPosts).set({ deletedAt: new Date() }).where(eq(S.feedPosts.id, id));
  if (!own) await logAudit(req.actor!.email, "feed.remove", "feed_post", id, { authorId: p.employeeId });
  res.json({ ok: true });
}));

// =====================================================================
// My privacy: consents, receipts, policies and agreements in one place
// =====================================================================
const purposeLabel = (key: string) =>
  key === VIBE_PURPOSE ? "Sharing my vibe page" : sectionLabel(key) ? `Vibe page: ${sectionLabel(key)}` : key === FEED_PURPOSE ? "Team feed post" : key === "kudos_post" ? "Kudos posted under my name" : CONSENT_PURPOSES.find((p) => p.key === key)?.label ?? PROFILE_ACKNOWLEDGEMENTS.find((a) => a.key === key)?.short ?? key;

r.get("/me/privacy", wrap(async (req, res) => {
  const me = selfId(req);
  const [events, rows, pols, acks, letters] = await Promise.all([
    db.select().from(S.consentEvents).where(eq(S.consentEvents.subjectId, subjectOf(me))).orderBy(desc(S.consentEvents.at)),
    db.select().from(S.vibeSections).where(eq(S.vibeSections.employeeId, me)),
    db.select().from(S.policies).orderBy(asc(S.policies.title)),
    db.select().from(S.policyAcks).where(eq(S.policyAcks.employeeId, me)).orderBy(desc(S.policyAcks.at)),
    db.select({ id: S.letters.id, type: S.letters.type, refNo: S.letters.refNo, status: S.letters.status, issuedAt: S.letters.issuedAt })
      .from(S.letters).where(and(eq(S.letters.employeeId, me), inArray(S.letters.status, ["issued", "accepted"]))).orderBy(desc(S.letters.createdAt)),
  ]);
  const accepted = letters.length ? await db.select({ letterId: S.acceptanceLinks.letterId, acceptedAt: S.acceptanceLinks.acceptedAt }).from(S.acceptanceLinks)
    .where(inArray(S.acceptanceLinks.letterId, letters.map((l) => l.id))) : [];
  const latest = new Map<string, (typeof events)[number]>();
  for (const e of events) if (!latest.has(e.purposeKey)) latest.set(e.purposeKey, e);
  const page = latest.get(VIBE_PURPOSE);
  const sections = VIBE_SECTION_KEYS.map((key) => {
    const row = rows.find((x) => x.sectionKey === key);
    return { key, label: VIBE_SECTIONS[key].label, filled: !!row, audience: (row?.audience ?? "only_me") as Audience, at: row?.updatedAt ?? null };
  });
  const profileChoices = CONSENT_PURPOSES.map((p) => { const ev = latest.get(p.key); return { key: p.key, label: p.label, consent: ev?.status ?? "not_set", at: ev?.at ?? null }; });
  res.json({
    vibeConsent: consentOut(page), sections, profileChoices,
    history: events.map((e) => ({ id: e.id, receipt: receiptNo(e.id, e.at), purpose: e.purposeKey, label: purposeLabel(e.purposeKey), status: e.status, noticeVersion: e.noticeVersion, at: e.at, detail: e.detail })),
    policies: pols.map((p) => {
      const mine = acks.filter((a) => a.policyId === p.id);
      const cur = mine.find((a) => a.version === p.currentVersion);
      const prev = mine.filter((a) => a.version < p.currentVersion).sort((a, b) => b.version - a.version)[0];
      return { slug: p.slug, title: p.title, version: p.currentVersion, status: cur ? "acknowledged" : prev ? "changed" : "to_read",
        acknowledgedAt: cur?.at ?? null, previous: prev ? { version: prev.version, at: prev.at } : null, history: mine.map((a) => ({ version: a.version, at: a.at })) };
    }),
    agreements: letters.map((l) => ({ id: l.id, type: l.type, refNo: l.refNo, status: l.status, issuedAt: l.issuedAt, acceptedAt: accepted.find((a) => a.letterId === l.id)?.acceptedAt ?? null })),
  });
}));

const IST = (d: Date | string | null | undefined, time = true) => d ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", ...(time ? { hour: "2-digit", minute: "2-digit" } : {}) }) : "";
const LETTER_LABEL: Record<string, string> = { offer_short: "Offer letter", offer_full: "Offer letter", appointment: "Appointment letter", appraisal: "Appraisal letter", experience: "Experience letter", relieving: "Relieving letter", pip: "Performance improvement plan", asset_contract: "Asset agreement" };
const AUD: Record<string, string> = { only_me: "Only me", team: "My team", everyone: "Everyone at Complynz" };

r.get("/me/privacy/export", wrap(async (req, res) => {
  const me = selfId(req);
  const [events, rows, pols, acks, posts, letters, page] = await Promise.all([
    db.select().from(S.consentEvents).where(eq(S.consentEvents.subjectId, subjectOf(me))).orderBy(desc(S.consentEvents.at)),
    db.select().from(S.vibeSections).where(eq(S.vibeSections.employeeId, me)),
    db.select().from(S.policies).orderBy(asc(S.policies.title)),
    db.select().from(S.policyAcks).where(eq(S.policyAcks.employeeId, me)).orderBy(desc(S.policyAcks.at)),
    db.select().from(S.feedPosts).where(eq(S.feedPosts.employeeId, me)).orderBy(desc(S.feedPosts.createdAt)),
    db.select({ id: S.letters.id, type: S.letters.type, refNo: S.letters.refNo, status: S.letters.status, issuedAt: S.letters.issuedAt })
      .from(S.letters).where(and(eq(S.letters.employeeId, me), inArray(S.letters.status, ["issued", "accepted"]))).orderBy(desc(S.letters.createdAt)),
    vibeGrants([me]).then((m) => m.get(me)),
  ]);
  const accepted = letters.length ? await db.select({ letterId: S.acceptanceLinks.letterId, acceptedAt: S.acceptanceLinks.acceptedAt }).from(S.acceptanceLinks)
    .where(inArray(S.acceptanceLinks.letterId, letters.map((l) => l.id))) : [];
  const sharing = pageGranted(page);
  const buf = toXlsx([
    { name: "Consents", header: ["Date and time (IST)", "What for", "Given or withdrawn", "Receipt number", "Notice version"],
      rows: events.map((e) => [IST(e.at), purposeLabel(e.purposeKey), e.status === "granted" ? "Given" : "Withdrawn", receiptNo(e.id, e.at), e.noticeVersion]) },
    { name: "Policies", header: ["Policy", "Version", "Status", "Acknowledged on (IST)"],
      rows: pols.map((p) => { const mine = acks.filter((a) => a.policyId === p.id); const cur = mine.find((a) => a.version === p.currentVersion);
        return [p.title, `v${p.currentVersion}`, cur ? "Acknowledged" : mine.length ? "Updated, needs your read" : "To read", IST(cur?.at)]; }) },
    { name: "Vibe page", header: ["Card", "Who can see it", "Last updated (IST)"],
      rows: rows.map((x) => [isVibeSection(x.sectionKey) ? VIBE_SECTIONS[x.sectionKey].label : x.sectionKey,
        x.audience === "only_me" ? "Only me" : sharing ? AUD[x.audience] ?? x.audience : `Only me (${AUD[x.audience] ?? x.audience} when sharing is on)`, IST(x.updatedAt)]) },
    { name: "Letters", header: ["Letter", "Reference", "Status", "Issued on (IST)", "Accepted on (IST)"],
      rows: letters.map((l) => [LETTER_LABEL[l.type] ?? l.type, l.refNo, l.status === "accepted" ? "Accepted" : "Issued", IST(l.issuedAt, false), IST(accepted.find((a) => a.letterId === l.id)?.acceptedAt, false)]) },
    { name: "Team feed posts", header: ["Date (IST)", "Type", "Text or link", "Audience", "Deleted"],
      rows: posts.map((p) => [IST(p.createdAt), FEED_KIND_LABEL[p.kind as FeedKind] ?? p.kind, p.kind === "quote" ? `${p.quote ?? ""}${p.source ? ` — ${p.source}` : ""}` : [p.title, p.url].filter(Boolean).join(" · "),
        AUD[p.audience] ?? p.audience, p.deletedAt ? `Yes, ${IST(p.deletedAt)}` : "No"]) },
  ]);
  const date = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="my-privacy-${date}.xlsx"`);
  res.send(buf);
}));

export default r;
