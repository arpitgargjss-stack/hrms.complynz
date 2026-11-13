export function nextEmployeeCode(existing: string[]): string {
  const max = existing.map((c) => /^CMPZ(\d+)$/.exec(c)?.[1]).filter(Boolean).map(Number).reduce((a, b) => Math.max(a, b as number), 0);
  return "CMPZ" + String(max + 1).padStart(3, "0");
}
/** Letter reference CMPZ/HR/<year>/<seq> */
export function letterRef(year: number, seq: number): string { return `CMPZ/HR/${year}/${String(seq).padStart(4, "0")}`; }

export const CONSENT_PURPOSES = [
  { key: "bgv_sharing", label: "Share my details with background-verification partners", required: false },
  { key: "non_essential_comms", label: "Receive non-essential communication", required: false },
  { key: "media_marketing", label: "Use my photo, voice or video in marketing", required: false },
  { key: "biometric", label: "Use biometric data such as fingerprint for attendance or access", required: false },
  { key: "intra_group_sharing", label: "Share my details with group companies", required: false },
  { key: "show_birthday", label: "Show my birthday (day and month) to colleagues", required: false },
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
