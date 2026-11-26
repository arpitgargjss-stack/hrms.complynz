/**
 * The employee's own details printed in the NDA (Annexure A of the full offer letter): who they are, their PAN,
 * the last 4 digits of their Aadhaar, their address, and when and where the agreement was executed.
 * They come from the candidate's onboarding submission (and, once they have joined, the employee record),
 * so a letter that was issued before onboarding fills in by itself when it is opened again.
 */
export type NdaParty = {
  relationName?: string | null; dob?: string | null; pan?: string | null; aadhaarLast4?: string | null; address?: string | null;
  employeeCode?: string | null;
};

const clean = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ") : null);

/** First non-empty value per field, in the order given (earlier sources win). */
export function mergeParty(...sources: (Partial<Record<keyof NdaParty, unknown>> | null | undefined)[]): NdaParty {
  const keys: (keyof NdaParty)[] = ["relationName", "dob", "pan", "aadhaarLast4", "address", "employeeCode"];
  const out: NdaParty = {};
  for (const k of keys) for (const s of sources) { const v = clean(s?.[k]); if (v) { out[k] = v; break; } }
  if (out.aadhaarLast4 && !/^\d{4}$/.test(out.aadhaarLast4)) out.aadhaarLast4 = null;
  if (out.dob && !/^\d{4}-\d{2}-\d{2}$/.test(out.dob)) out.dob = null;
  return out;
}

/** Age in completed years on a given day, or null for a missing or impossible date of birth. */
export function ageOn(dob: string | null | undefined, on: Date): number | null {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const [y, m, d] = dob.split("-").map(Number);
  let age = on.getUTCFullYear() - y;
  if (on.getUTCMonth() + 1 < m || (on.getUTCMonth() + 1 === m && on.getUTCDate() < d)) age--;
  return age >= 14 && age <= 100 ? age : null;
}

/** "26th" for 26, "1st" for 1, and so on, for "on this 26th day of November, 2026". */
export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

/** Day, month and year of an instant in India time, for the execution date. */
export function istParts(at: Date): { day: number; month: string; year: number } {
  const ist = new Date(at.getTime() + 330 * 60_000);
  return { day: ist.getUTCDate(), month: ist.toLocaleDateString("en-IN", { month: "long", timeZone: "UTC" }), year: ist.getUTCFullYear() };
}
