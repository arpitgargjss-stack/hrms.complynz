/** Fields every employee fills in themselves on first login. Bank details stay optional here (HR can also enter them). */
export const REQUIRED_PROFILE_FIELDS = [
  { key: "photoFileId", label: "Profile photo" },
  { key: "phone", label: "Mobile number" },
  { key: "personalEmail", label: "Personal email" },
  { key: "dob", label: "Date of birth" },
  { key: "gender", label: "Gender" },
  { key: "currentAddress", label: "Current address" },
  { key: "emergencyContactName", label: "Emergency contact name" },
  { key: "emergencyContactRelation", label: "Emergency contact relation" },
  { key: "emergencyContactPhone", label: "Emergency contact number" },
] as const;
export type ProfileFieldKey = (typeof REQUIRED_PROFILE_FIELDS)[number]["key"];

/** Keys of required fields that are still empty. */
export function missingProfileFields(e: Partial<Record<ProfileFieldKey, string | null | undefined>>): ProfileFieldKey[] {
  return REQUIRED_PROFILE_FIELDS.filter((f) => !String(e[f.key] ?? "").trim()).map((f) => f.key);
}

/** Once marked complete the prompt never comes back, even if HR later clears a field. */
export function isProfileComplete(e: Partial<Record<ProfileFieldKey, string | null | undefined>> & { profileCompletedAt?: unknown }): boolean {
  return !!e.profileCompletedAt || missingProfileFields(e).length === 0;
}
