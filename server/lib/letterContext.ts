import { signatoryMarks, type Marks } from "./signatureMarks";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { offerConsentRecord } from "./offerConsents";
import { db, schema } from "../db";
import { COMPANY_DEFAULTS, type CompanyProfile } from "../../shared/hr/letters";
import { TEMPLATE_PRESETS } from "../../shared/hr/presets";
import type { ComponentDef } from "../../shared/hr/payroll";
import { mergeParty, type NdaParty } from "../../shared/hr/ndaParty";
import { decryptField } from "./crypto";

const plain = (enc: string | null | undefined) => { if (!enc) return null; try { return decryptField(enc); } catch { return null; } };

/**
 * The employee's details for the NDA in the full offer letter. Read fresh every time the letter is opened, so a
 * letter issued (or accepted) before onboarding shows the values once the candidate submits them. The employee
 * record wins over the onboarding submission once they have joined, since HR can correct it there.
 */
export async function ndaParty(candidateId?: string | null, employeeId?: string | null): Promise<NdaParty | null> {
  const [[link], [emp]] = await Promise.all([
    candidateId ? db.select({ submitted: schema.onboardingLinks.submitted }).from(schema.onboardingLinks)
      .where(and(eq(schema.onboardingLinks.candidateId, candidateId), isNotNull(schema.onboardingLinks.completedAt))).orderBy(desc(schema.onboardingLinks.completedAt)).limit(1) : [],
    employeeId ? db.select({ dob: schema.employees.dob, address: schema.employees.currentAddress, panEnc: schema.employees.panEnc, code: schema.employees.code })
      .from(schema.employees).where(eq(schema.employees.id, employeeId)).limit(1) : [],
  ]);
  if (!link && !emp) return null;
  const s = (link?.submitted ?? {}) as { personal?: Record<string, unknown>; panEnc?: string };
  const personal = s.personal ?? {};
  return mergeParty(
    emp ? { dob: emp.dob, address: emp.address, pan: plain(emp.panEnc), employeeCode: emp.code } : null,
    { relationName: personal.relationName, dob: personal.dob, address: personal.address, aadhaarLast4: personal.aadhaarLast4, pan: plain(s.panEnc) },
  );
}

/** What a letter needs besides its own payload: company details and, for offers, the salary structure. */
export async function letterContext(l: { type: string; payload: Record<string, unknown>; candidateId?: string | null; employeeId?: string | null; status?: string }): Promise<{ company: CompanyProfile; components: ComponentDef[] | null; consentRecord?: Record<string, { granted: boolean; at: string }> | null; acceptedAt?: Date | null; marks?: Marks; party?: NdaParty | null }> {
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
    return { company, components, consentRecord: await offerConsentRecord(l.candidateId), acceptedAt: link?.at ?? null, marks: await signatoryMarks(company.signatoryName), party: l.type === "offer_full" ? await ndaParty(l.candidateId, l.employeeId) : null };
  }
  return { company, components, marks: await signatoryMarks(company.signatoryName), party: l.type === "offer_full" ? await ndaParty(l.candidateId, l.employeeId) : null };
}
