import { createHash } from "node:crypto";
import { desc } from "drizzle-orm";
import { db, schema } from "../db";
import { renderTemplate, PLACEHOLDERS, type Values } from "../../shared/hr/placeholders";
import { convertLegacyHtml } from "../../shared/hr/legacyPolicy";
import { sanitizeHtml } from "./sanitizeHtml";

/**
 * Policies are filled in with the current Configuration values every time they are shown. A version published before
 * templates existed (no `template`) is read through the legacy converter, so its [blanks] fill in too.
 */
type Ver = { template: string | null; html: string; fileId?: string | null };
export const templateOf = (v: Ver) => v.template ?? convertLegacyHtml(v.html).template;
export function renderLive(v: Ver, values: Values) {
  const r = renderTemplate(templateOf(v), values);
  const html = sanitizeHtml(r.html);
  return { ...r, html, legacy: !v.template, contentHash: createHash("sha256").update(html).digest("hex") };
}

/** When each group of values was last changed, for "Updated details" lines in version history. */
export async function valueUpdatedAt(): Promise<Record<string, Date | null>> {
  const [roles, [co], [reimb]] = await Promise.all([
    db.select({ role: schema.orgRoles.role, at: schema.orgRoles.createdAt }).from(schema.orgRoles),
    db.select({ at: schema.companyProfile.updatedAt }).from(schema.companyProfile).orderBy(desc(schema.companyProfile.id)).limit(1),
    db.select({ at: schema.reimbursementPolicy.updatedAt }).from(schema.reimbursementPolicy).orderBy(desc(schema.reimbursementPolicy.id)).limit(1),
  ]);
  const latest = (pred: (r: string) => boolean) => roles.filter((r) => pred(r.role)).reduce<Date | null>((m, r) => (!m || r.at > m ? r.at : m), null);
  return { "POSH committee": latest((r) => r.startsWith("posh_")), Contacts: latest((r) => !r.startsWith("posh_")), Company: co?.at ?? null, Reimbursement: reimb?.at ?? null, Leave: null };
}
/** Groups of values a policy uses that changed after `since`, e.g. "POSH committee changed on 22 Nov 2026". */
export async function detailUpdates(keys: string[], since: Date | null) {
  const at = await valueUpdatedAt();
  const groups = [...new Set(keys.map((k) => PLACEHOLDERS.find((p) => p.key === k)?.group).filter(Boolean))] as string[];
  return groups.map((g) => ({ group: g, at: at[g] ?? null })).filter((x) => x.at && (!since || x.at > since)) as { group: string; at: Date }[];
}
