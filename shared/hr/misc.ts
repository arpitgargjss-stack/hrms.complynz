export function nextEmployeeCode(existing: string[]): string {
  const max = existing.map((c) => /^CMPZ(\d+)$/.exec(c)?.[1]).filter(Boolean).map(Number).reduce((a, b) => Math.max(a, b as number), 0);
  return "CMPZ" + String(max + 1).padStart(3, "0");
}
/** Letter reference CMPZ/HR/<year>/<seq> */
export function letterRef(year: number, seq: number): string { return `CMPZ/HR/${year}/${String(seq).padStart(4, "0")}`; }

/** Optional purposes asked at offer acceptance and in My privacy. `detail` and `retention` are printed in the full offer letter (Part B). */
export const CONSENT_PURPOSES = [
  { key: "bgv_sharing", label: "Share my details with background-verification partners", required: false, title: "Third-Party KYC / Background Verification Sharing",
    detail: "sharing your identity, address, education and employment-history documents with Company-appointed third-party KYC/background-verification agencies, solely for authentication of the information provided by you.", retention: "Engagement period + 7 years" },
  { key: "non_essential_comms", label: "Receive non-essential communication", required: false, title: "Non-Essential Communication",
    detail: "use of your personal mobile number, personal email ID and/or WhatsApp for non-essential Company communication, such as engagement/culture updates, events, newsletters and post-exit alumni communication (statutory and payroll communication is covered under Part A above and is not affected by your choice here).", retention: "Engagement period + 2 years post-exit, or until withdrawn" },
  { key: "media_marketing", label: "Use my photo, voice or video in marketing", required: false, title: "Photograph, Voice & Video for External/Marketing Use",
    detail: "use of your photograph, voice or video recording on the Company’s public website, social media handles, marketing collateral, case studies or press releases.", retention: "Until withdrawn, or engagement + 3 years, whichever is earlier" },
  { key: "biometric", label: "Use biometric data such as fingerprint for attendance or access", required: false, title: "Biometric Data for Access & Attendance",
    detail: "collection and processing of fingerprint/facial-recognition data solely for office access control and attendance tracking, where such systems are deployed at your work location.", retention: "Duration of deployment of the system at your work location, not exceeding the engagement period" },
  { key: "intra_group_sharing", label: "Share my details with group companies", required: false, title: "Intra-Group Sharing for Benefits & Mobility",
    detail: "sharing your contact and employment details with the Company’s Affiliates/group entities for internal mobility, group-wide benefits or referral opportunities.", retention: "Engagement period + 1 year, or until withdrawn" },
  { key: "show_birthday", label: "Show my birthday (day and month) to colleagues", required: false, title: "Birthday on the Home Page",
    detail: "showing the day and month of your birthday (never the year) to colleagues on the HR app home page.", retention: "Until withdrawn, or the end of engagement" },
  { key: "login_activity", label: "Record the days I sign in (date only, no times or devices), for company-wide usage counts", required: false, title: "Sign-in Days for Usage Counts",
    detail: "recording the dates on which you sign in to the HR app (no times, devices or locations), used only for company-wide counts of how many people use it, never reported by name.", retention: "Rolling 13 months, deleted at once if withdrawn" },
] as const;

/** Reason categories for a resignation. Only counts by category are ever shown on dashboards. */
export const RESIGNATION_REASONS = [
  { key: "better_role", label: "Better role or pay elsewhere" },
  { key: "higher_studies", label: "Higher studies" },
  { key: "relocation", label: "Relocation" },
  { key: "personal", label: "Personal or family" },
  { key: "health", label: "Health" },
  { key: "work_culture", label: "Work, manager or culture" },
  { key: "career_change", label: "Career change" },
  { key: "other", label: "Other" },
] as const;
export type ConsentPurposeKey = (typeof CONSENT_PURPOSES)[number]["key"];

/** Show people with a birthday/anniversary in the next N days. Birthdays only for those who opted in. */
export function upcomingEvents(today: string, people: { id: string; name: string; dob?: string | null; joiningDate: string; birthdayOptIn: boolean }[], days = 30) {
  const t = new Date(today + "T00:00:00Z");
  const out: { id: string; name: string; kind: "birthday" | "anniversary"; date: string; years?: number }[] = [];
  const next = (md: string) => {
    let d = new Date(`${t.getUTCFullYear()}-${md}T00:00:00Z`);
    if (d < t) d = new Date(`${t.getUTCFullYear() + 1}-${md}T00:00:00Z`);
    return d;
  };
  const within = (d: Date) => (d.getTime() - t.getTime()) / 86400000 <= days;
  for (const p of people) {
    if (p.dob && p.birthdayOptIn) { const d = next(p.dob.slice(5)); if (within(d)) out.push({ id: p.id, name: p.name, kind: "birthday", date: d.toISOString().slice(5, 10) }); }
    const a = next(p.joiningDate.slice(5)); const years = a.getUTCFullYear() - Number(p.joiningDate.slice(0, 4));
    if (years >= 1 && within(a)) out.push({ id: p.id, name: p.name, kind: "anniversary", date: a.toISOString().slice(5, 10), years });
  }
  return out.sort((x, y) => (x.date < y.date ? -1 : 1));
}

/** Anonymous survey results are shown only with enough responses. */
export const MIN_ANONYMOUS_RESPONSES = 5;
export function shouldShowResults(responseCount: number): boolean { return responseCount >= MIN_ANONYMOUS_RESPONSES; }
