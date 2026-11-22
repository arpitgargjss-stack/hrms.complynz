/** Work fields whose before/after values are safe to keep in the audit log (no personal, ID or bank data). */
export const AUDITED_WORK_FIELDS = ["fullName", "workEmail", "joiningDate", "departmentId", "designationId", "locationId", "employmentType", "status", "lastWorkingDay"] as const;

export type FieldChange = { from: unknown; to: unknown };

/** Before/after for each audited work field that actually changed. */
export function workFieldChanges(before: Partial<Record<string, unknown>>, after: Partial<Record<string, unknown>>): Record<string, FieldChange> {
  const out: Record<string, FieldChange> = {};
  for (const k of AUDITED_WORK_FIELDS) {
    const f = before[k] ?? null, t = after[k] ?? null;
    if (f !== t) out[k] = { from: f, to: t };
  }
  return out;
}
