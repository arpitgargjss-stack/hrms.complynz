import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { offerConsentRecord } from "./offerConsents";
import { db, schema } from "../db";
import { COMPANY_DEFAULTS, type CompanyProfile } from "../../shared/hr/letters";
import { TEMPLATE_PRESETS } from "../../shared/hr/presets";
import type { ComponentDef } from "../../shared/hr/payroll";

/** What a letter needs besides its own payload: company details and, for offers, the salary structure. */
export async function letterContext(l: { type: string; payload: Record<string, unknown>; candidateId?: string | null; status?: string }): Promise<{ company: CompanyProfile; components: ComponentDef[] | null; consentRecord?: Record<string, { granted: boolean; at: string }> | null; acceptedAt?: Date | null }> {
  const [row] = await db.select().from(schema.companyProfile).orderBy(desc(schema.companyProfile.id)).limit(1);
  const company = { ...COMPANY_DEFAULTS, ...((row?.settings ?? {}) as Partial<CompanyProfile>) };
  let components: ComponentDef[] | null = null;
  const key = typeof l.payload.templateKey === "string" ? l.payload.templateKey : "";
  if (/^[0-9a-f-]{36}$/.test(key)) {
    const [t] = await db.select().from(schema.salaryTemplates).where(eq(schema.salaryTemplates.id, key)).limit(1);
    components = (t?.components as ComponentDef[]) ?? null;
  } else if (key) components = TEMPLATE_PRESETS.find((t) => t.key === key)?.components ?? null;
  // An accepted offer shows the consents and e-signature the candidate recorded online.
  if (l.candidateId && l.status === "accepted" && (l.type === "offer_full" || l.type === "offer_short")) {
    const ls = await db.select({ id: schema.letters.id }).from(schema.letters).where(eq(schema.letters.candidateId, l.candidateId));
    const [link] = ls.length ? await db.select({ at: schema.acceptanceLinks.acceptedAt }).from(schema.acceptanceLinks).where(and(inArray(schema.acceptanceLinks.letterId, ls.map((x) => x.id)), isNotNull(schema.acceptanceLinks.acceptedAt))).orderBy(desc(schema.acceptanceLinks.acceptedAt)).limit(1) : [];
    return { company, components, consentRecord: await offerConsentRecord(l.candidateId), acceptedAt: link?.at ?? null };
  }
  return { company, components };
}
