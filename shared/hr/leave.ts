export interface CalendarSettings {
  weeklyOff: number[]; // 0=Sun..6=Sat
  saturdays: { mode: "all_working" | "all_off" | "alternate"; offWeeks?: number[] }; // week-of-month numbers that are off
  workStart: string; workEnd: string; // HH:mm; with flexi timing these are the earliest start and the earliest finish
  latestStart?: string; latestEnd?: string; // HH:mm; end of the flexi windows (arrive by latestStart, leave by latestEnd)
  wfhDays?: number[]; // 0=Sun..6=Sat; working days on which everyone works from home (punch allowed, no geofence)
}
export interface Holiday { date: string; optional?: boolean }

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(s + "T00:00:00Z");

export function isWorkingDay(date: string, cal: CalendarSettings, holidays: Holiday[]): boolean {
  const d = parse(date);
  const dow = d.getUTCDay();
  if (holidays.some((h) => h.date === date && !h.optional)) return false;
  if (cal.weeklyOff.includes(dow)) return false;
  if (dow === 6) {
    if (cal.saturdays.mode === "all_off") return false;
    if (cal.saturdays.mode === "alternate") {
      const week = Math.ceil(d.getUTCDate() / 7);
      if ((cal.saturdays.offWeeks ?? []).includes(week)) return false;
    }
  }
  return true;
}

/** Working days between two dates inclusive, in half-days (x2). Half-day request counts 1. */
export function leaveDaysX2(from: string, to: string, halfDay: boolean, cal: CalendarSettings, holidays: Holiday[]): number {
  if (to < from) throw new Error("End date before start date");
  if (halfDay) {
    if (from !== to) throw new Error("Half day must be a single date");
    return isWorkingDay(from, cal, holidays) ? 1 : 0;
  }
  let n = 0;
  for (let d = parse(from); iso(d) <= to; d.setUTCDate(d.getUTCDate() + 1)) if (isWorkingDay(iso(d), cal, holidays)) n += 2;
  return n;
}

export interface LeaveTypeCfg { annualQuotaHalfDays: number; carryForwardHalfDays: number; accrual: "upfront" | "monthly" }

/** Entitlement (half-days) for a leave year starting 1 Jan, given the date and joining date. */
export function entitlementX2(t: LeaveTypeCfg, asOf: string, joiningDate: string, carriedIn = 0): number {
  const year = Number(asOf.slice(0, 4));
  const startMonth = joiningDate.startsWith(String(year)) ? Number(joiningDate.slice(5, 7)) : 1;
  const month = Number(asOf.slice(5, 7));
  const eligibleMonths = Math.max(0, month - startMonth + 1);
  const carry = Math.min(carriedIn, t.carryForwardHalfDays);
  if (t.accrual === "upfront") {
    const monthsInYear = 12 - startMonth + 1;
    return Math.floor((t.annualQuotaHalfDays * monthsInYear) / 12) + carry;
  }
  return Math.floor((t.annualQuotaHalfDays * eligibleMonths) / 12) + carry;
}

export function balanceX2(entitled: number, usedApproved: number, pending: number) {
  return { available: entitled - usedApproved - pending, used: usedApproved, pending };
}

/** Month's payable days (x2) = calendar days minus unpaid-leave and absent days. */
export function paidDaysX2(calendarDays: number, lossOfPayDaysX2: number): number {
  return Math.max(0, calendarDays * 2 - lossOfPayDaysX2);
}
