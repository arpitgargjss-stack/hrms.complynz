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

/** Version of the first-login employee privacy notice the acknowledgements below refer to. */
export const PROFILE_NOTICE_VERSION = "profile-v1";

/**
 * Must-tick acknowledgements on the first-login screen. Processing needed to employ and pay someone is a "legitimate use"
 * under the DPDP Act, so these record that the person read the notice and vouches for the details, not an opt-in.
 * They are kept in the consent log with the date and time and cannot be withdrawn.
 */
export const PROFILE_ACKNOWLEDGEMENTS = [
  { key: "ack_privacy_notice", short: "Read the employee privacy notice", label: "I have read the employee privacy notice and understand how the company uses my details for employment, payroll, tax and statutory filings." },
  { key: "ack_details_accurate", short: "Confirmed my profile details are true", label: "The details I have given are true and complete, and I will update them here if they change." },
  { key: "ack_emergency_contact", short: "Told my emergency contact I shared their details", label: "My emergency contact knows I have shared their name and number, to be used only if something happens to me at work." },
] as const;
export type ProfileAckKey = (typeof PROFILE_ACKNOWLEDGEMENTS)[number]["key"];

/** Acknowledgement keys not yet recorded, given the person's latest consent status per purpose key. */
export function missingAcknowledgements(latest: Map<string, string> | Record<string, string | undefined>): ProfileAckKey[] {
  const get = (k: string) => (latest instanceof Map ? latest.get(k) : latest[k]);
  return PROFILE_ACKNOWLEDGEMENTS.filter((a) => get(a.key) !== "granted").map((a) => a.key);
}
