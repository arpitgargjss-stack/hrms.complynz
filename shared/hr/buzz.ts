import { z } from "zod";
import { isWorkingDay, type CalendarSettings, type Holiday } from "./leave";

export const KUDOS_VALUES = ["Ownership", "Customer love", "Helping hand", "Big brain", "Team player", "Wishes"] as const;
export type KudosValue = (typeof KUDOS_VALUES)[number];
export const kudosInput = z.object({
  toEmployeeId: z.string().uuid(), value: z.enum(KUDOS_VALUES), message: z.string().trim().min(3).max(400),
}).strict();

export const MOODS = ["Rough", "Meh", "Okay", "Good", "Great"] as const;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

/** ISO week label, e.g. 2026-W47. */
export function isoWeek(date: string): string {
  const d = new Date(date + "T00:00:00Z");
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y = d.getUTCFullYear();
  const wk = Math.ceil(((d.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(wk).padStart(2, "0")}`;
}

/**
 * Forgiving "start my day" streak: consecutive working days with a punch-in, counting back from today
 * (today only counts once punched). Weekends, holidays and approved leave pause the streak; they never break it.
 * Private to the person: never shown to managers or used anywhere else.
 */
export function startStreak(today: string, punchedDays: Set<string>, onLeave: (d: string) => boolean, cal: CalendarSettings, holidays: Holiday[], maxDays = 180): number {
  let n = 0;
  for (let i = 0; i < maxDays; i++) {
    const d = addDays(today, -i);
    if (!isWorkingDay(d, cal, holidays) || onLeave(d)) continue;
    if (punchedDays.has(d)) { n++; continue; }
    if (i === 0) continue; // not punched yet today: the streak from yesterday still stands
    break;
  }
  return n;
}

/**
 * Long-weekend ideas from the holiday list: a holiday next to a weekend with one or two working days
 * in between. Returns the leave days to take and the run of days off it creates.
 */
export function longWeekendTips(today: string, cal: CalendarSettings, holidays: (Holiday & { name: string })[], horizonDays = 90) {
  const end = addDays(today, horizonDays);
  const tips: { holiday: string; holidayDate: string; take: string[]; from: string; to: string; daysOff: number }[] = [];
  for (const h of holidays) {
    if (h.optional || h.date < today || h.date > end) continue;
    for (const dir of [-1, 1]) {
      const take: string[] = [];
      let d = addDays(h.date, dir);
      while (take.length <= 2 && isWorkingDay(d, cal, holidays)) { take.push(d); d = addDays(d, dir); }
      if (!take.length || take.length > 2 || take.some((x) => x <= today)) continue;
      let from = h.date, to = h.date;
      while (!isWorkingDay(addDays(from, -1), cal, holidays) || take.includes(addDays(from, -1))) from = addDays(from, -1);
      while (!isWorkingDay(addDays(to, 1), cal, holidays) || take.includes(addDays(to, 1))) to = addDays(to, 1);
      const daysOff = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
      if (daysOff >= 4) tips.push({ holiday: h.name, holidayDate: h.date, take: take.sort(), from, to, daysOff });
    }
  }
  return tips.sort((a, b) => b.daysOff / b.take.length - a.daysOff / a.take.length || a.from.localeCompare(b.from)).slice(0, 2);
}
