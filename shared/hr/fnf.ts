/**
 * Full and final settlement. Pure arithmetic in paise; the rules are configurable per company.
 * Defaults follow common Indian practice: leave encashment and notice recovery on basic pay per day (monthly / 30),
 * gratuity at 15/26 of last basic per completed year after 5 years (a part year over 6 months counts as a year), capped at ₹20 lakh,
 * and payment within 2 working days of the last day (Code on Wages, 2019, section 17(2)).
 */
export type FnfRules = {
  encashLeaveKeys: string[]; encashMaxDays: number; encashBasis: "basic" | "gross"; dayDivisor: number;
  noticeRecovery: boolean; noticeBasis: "basic" | "gross"; payNoticeIfCompanyEnds: boolean;
  gratuity: { enabled: boolean; minYears: number; capPaise: number }; payWithinWorkingDays: number;
};
export const FNF_DEFAULTS: FnfRules = {
  encashLeaveKeys: ["earned", "privilege", "annual", "casual"], encashMaxDays: 30, encashBasis: "basic", dayDivisor: 30,
  noticeRecovery: true, noticeBasis: "basic", payNoticeIfCompanyEnds: true,
  gratuity: { enabled: false, minYears: 5, capPaise: 20_00_000_00 }, payWithinWorkingDays: 2,
};

export type FnfLine = { label: string; amountPaise: number; note?: string };
export type FnfInput = {
  monthlyGrossPaise: number; monthlyBasicPaise: number; joiningDate: string; lastWorkingDay: string;
  unpaidDays: number; calendarDays: number; encashableLeaveDays: number;
  noticeRequiredDays: number; noticeServedDays: number; waiveNotice: boolean;
  extraEarnings: FnfLine[]; deductions: FnfLine[];
};
export type FnfResult = { earnings: FnfLine[]; deductions: FnfLine[]; totalEarningsPaise: number; totalDeductionsPaise: number; netPaise: number; serviceYears: number; gratuityYears: number };

/** Completed years of service, with the months left over. */
export function service(joining: string, last: string): { years: number; months: number } {
  const [y1, m1, d1] = joining.split("-").map(Number), [y2, m2, d2] = last.split("-").map(Number);
  let months = (y2 - y1) * 12 + (m2 - m1) - (d2 + 1 < d1 ? 1 : 0);
  if (months < 0) months = 0;
  return { years: Math.floor(months / 12), months: months % 12 };
}

export function computeFnf(i: FnfInput, r: FnfRules = FNF_DEFAULTS): FnfResult {
  const perDay = (basis: "basic" | "gross") => (basis === "basic" ? i.monthlyBasicPaise : i.monthlyGrossPaise) / r.dayDivisor;
  const earnings: FnfLine[] = [], deductions: FnfLine[] = [];
  if (i.unpaidDays > 0) earnings.push({ label: "Salary for days worked, not yet paid", amountPaise: Math.round((i.monthlyGrossPaise * i.unpaidDays) / i.calendarDays), note: `${i.unpaidDays} of ${i.calendarDays} days` });
  const leaveDays = Math.min(Math.max(0, i.encashableLeaveDays), r.encashMaxDays);
  if (leaveDays > 0) earnings.push({ label: "Leave encashment", amountPaise: Math.round(perDay(r.encashBasis) * leaveDays), note: `${leaveDays} days at ${r.encashBasis} ÷ ${r.dayDivisor}${i.encashableLeaveDays > r.encashMaxDays ? `, capped at ${r.encashMaxDays} days` : ""}` });
  const s = service(i.joiningDate, i.lastWorkingDay);
  const gYears = s.years + (s.months > 6 ? 1 : 0);
  if (r.gratuity.enabled && s.years >= r.gratuity.minYears) {
    const g = Math.min(r.gratuity.capPaise, Math.round((i.monthlyBasicPaise * 15 * gYears) / 26));
    earnings.push({ label: "Gratuity", amountPaise: g, note: `15/26 × last basic × ${gYears} years` });
  }
  earnings.push(...i.extraEarnings.filter((l) => l.amountPaise > 0));
  const short = Math.max(0, i.noticeRequiredDays - i.noticeServedDays);
  if (r.noticeRecovery && short > 0 && !i.waiveNotice) deductions.push({ label: "Notice period not served", amountPaise: Math.round(perDay(r.noticeBasis) * short), note: `${short} days at ${r.noticeBasis} ÷ ${r.dayDivisor}` });
  deductions.push(...i.deductions.filter((l) => l.amountPaise > 0));
  const te = earnings.reduce((a, l) => a + l.amountPaise, 0), td = deductions.reduce((a, l) => a + l.amountPaise, 0);
  return { earnings, deductions, totalEarningsPaise: te, totalDeductionsPaise: td, netPaise: te - td, serviceYears: s.years, gratuityYears: gYears };
}

/** Last day plus N working days (Monday to Saturday), for the payment deadline. */
export function payBy(lastWorkingDay: string, workingDays: number): string {
  const d = new Date(lastWorkingDay + "T00:00:00Z"); let n = 0;
  while (n < workingDays) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() !== 0) n++; }
  return d.toISOString().slice(0, 10);
}
