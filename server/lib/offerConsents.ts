import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "../db";
import { hmac } from "./crypto";

/**
 * Consents a candidate gives on the offer acceptance page are recorded under an opaque candidate subject
 * (derived from the acceptance link). These helpers find them for a candidate and copy them to the employee's
 * consent log when the candidate joins, so the choices follow the person without asking again.
 */
const A = schema;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const candidateSubject = (tokenHash: string) => "cand_" + hmac(tokenHash, "subject").slice(0, 24);

async function subjectsFor(q: typeof db | Tx, candidateId: string): Promise<string[]> {
  const ls = await q.select({ id: A.letters.id }).from(A.letters).where(eq(A.letters.candidateId, candidateId));
  if (!ls.length) return [];
  const links = await q.select({ th: A.acceptanceLinks.tokenHash }).from(A.acceptanceLinks).where(and(inArray(A.acceptanceLinks.letterId, ls.map((l) => l.id)), isNotNull(A.acceptanceLinks.acceptedAt)));
  return links.map((l) => candidateSubject(l.th));
}

/** Latest choice per purpose that a candidate recorded online, or null if they have not accepted online. */
export async function offerConsentRecord(candidateId: string, q: typeof db | Tx = db): Promise<Record<string, { granted: boolean; at: string }> | null> {
  const subjects = await subjectsFor(q, candidateId);
  if (!subjects.length) return null;
  const ev = await q.select().from(A.consentEvents).where(inArray(A.consentEvents.subjectId, subjects)).orderBy(desc(A.consentEvents.at));
  const out: Record<string, { granted: boolean; at: string }> = {};
  for (const e of ev) if (!out[e.purposeKey]) out[e.purposeKey] = { granted: e.status === "granted", at: e.at.toISOString() };
  return out;
}

/** Copy the candidate's latest choices into the employee's consent log. Returns how many were carried over. */
export async function carryOfferConsents(tx: Tx, candidateId: string, employeeId: string): Promise<number> {
  const rec = await offerConsentRecord(candidateId, tx);
  if (!rec) return 0;
  const rows = Object.entries(rec).map(([purposeKey, r]) => ({
    subjectId: `emp_${employeeId}`, purposeKey, status: r.granted ? "granted" : "withdrawn", noticeVersion: "offer-v1", source: "carried_from_offer",
    detail: { givenAt: r.at, via: "offer acceptance page" },
  }));
  if (rows.length) await tx.insert(A.consentEvents).values(rows);
  return rows.length;
}
