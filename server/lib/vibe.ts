import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema as S } from "../db";
import { VIBE_SECTIONS, VIBE_PURPOSE, canSeeSection, sameTeam, isVibeSection, type Audience, type VibeSectionKey } from "../../shared/hr/vibe";

/** Consent subject for an employee. Same opaque format the profile consents use, so the CMP sees one subject. */
export const subjectOf = (employeeId: string) => "emp_" + employeeId;

export type Person = { id: string; departmentId: string | null; managerId: string | null };
export async function personOf(id: string): Promise<(Person & { status: string }) | null> {
  const [e] = await db.select({ id: S.employees.id, departmentId: S.employees.departmentId, managerId: S.employees.managerId, status: S.employees.status })
    .from(S.employees).where(eq(S.employees.id, id)).limit(1);
  return e ?? null;
}

/** Latest vibe page consent event per employee (one consent covers every card). */
export async function vibeGrants(employeeIds: string[]): Promise<Map<string, typeof S.consentEvents.$inferSelect>> {
  const out = new Map<string, typeof S.consentEvents.$inferSelect>();
  if (!employeeIds.length) return out;
  const rows = await db.select().from(S.consentEvents)
    .where(and(inArray(S.consentEvents.subjectId, employeeIds.map(subjectOf)), eq(S.consentEvents.purposeKey, VIBE_PURPOSE)))
    .orderBy(desc(S.consentEvents.at));
  for (const r of rows) { const id = r.subjectId.slice(4); if (!out.has(id)) out.set(id, r); }
  return out;
}
export const pageGranted = (ev: { status: string } | undefined) => ev?.status === "granted";

export type VisibleSection = { key: VibeSectionKey; content: unknown; audience: Audience; updatedAt: Date };
/**
 * Sections of `owners` that `viewer` may see. A section shows only when its audience allows the viewer
 * AND the owner's vibe page consent is "granted". The owner always sees their own.
 */
export async function visibleSections(viewer: Person, owners: Person[]): Promise<Map<string, VisibleSection[]>> {
  const ids = owners.map((o) => o.id);
  const out = new Map<string, VisibleSection[]>(ids.map((id) => [id, []]));
  if (!ids.length) return out;
  const [rows, grants] = await Promise.all([
    db.select().from(S.vibeSections).where(inArray(S.vibeSections.employeeId, ids)),
    vibeGrants(ids),
  ]);
  const byId = new Map(owners.map((o) => [o.id, o]));
  for (const r of rows) {
    if (!isVibeSection(r.sectionKey)) continue;
    const owner = byId.get(r.employeeId)!;
    const granted = pageGranted(grants.get(r.employeeId));
    if (!canSeeSection(r.audience as Audience, granted, { self: viewer.id === owner.id, sameTeam: sameTeam(viewer, owner) })) continue;
    out.get(r.employeeId)!.push({ key: r.sectionKey, content: r.content, audience: r.audience as Audience, updatedAt: r.updatedAt });
  }
  return out;
}

/** May `viewer` open this vibe photo? Only when the owner's Snaps section that holds it is visible to them. */
export async function canSeeVibePhoto(viewer: Person | null, ownerId: string | null, fileId: string): Promise<boolean> {
  if (!viewer || !ownerId) return false;
  if (viewer.id === ownerId) return true;
  const owner = await personOf(ownerId);
  if (!owner || owner.status === "exited") return false;
  const vis = (await visibleSections(viewer, [owner])).get(ownerId) ?? [];
  const snaps = vis.find((s) => s.key === "snaps")?.content as { photos?: { fileId: string }[] } | undefined;
  return !!snaps?.photos?.some((p) => p.fileId === fileId);
}

export const sectionLabel = (key: string) => (isVibeSection(key.replace(/^vibe_/, "")) ? VIBE_SECTIONS[key.replace(/^vibe_/, "") as VibeSectionKey].label : null);
