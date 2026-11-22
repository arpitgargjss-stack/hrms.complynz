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

/**
 * The Home check-in, "How are you feeling today?": three indexes, each 1 to 5 where 5 is always the good end.
 * Stressometer is stored that way too (5 = calm), so "low" means the same thing on every scale.
 * `key` is the column in hr_pulse_responses (the Happy Index keeps the original `mood` column so its history carries on).
 */
export const WELLBEING_INDEXES = [
  { key: "stress", name: "Stressometer", icon: "🌡️", emoji: ["🤯", "😫", "😬", "🙂", "😌"], q: "How stressed do you feel?", scale: ["Maxed out", "Very stressed", "Some stress", "A little", "Calm"] },
  { key: "mood", name: "Happy Index", icon: "😊", emoji: ["😞", "😕", "😐", "😄", "🤩"], q: "How happy are you at work?", scale: ["Not at all", "A little", "Okay", "Happy", "Very happy"] },
  { key: "motivation", name: "Motivation Index", icon: "⚡", emoji: ["🪫", "😴", "🙂", "💪", "🚀"], q: "How motivated do you feel?", scale: ["Running on empty", "Low", "Okay", "Motivated", "Fired up"] },
] as const;
export type WellbeingKey = (typeof WELLBEING_INDEXES)[number]["key"];
export const pulseInput = z.object({ stress: z.number().int().min(1).max(5), mood: z.number().int().min(1).max(5), motivation: z.number().int().min(1).max(5) }).strict();

/** An answer of 1 or 2 is "low": the person is offered an anonymous survey or a private conversation. Worked out in the browser only; never stored. */
export const isLowAnswer = (v: number | null | undefined) => typeof v === "number" && v <= 2;

/** A 1 to 5 average shown as an index out of 100 (1 = 0, 3 = 50, 5 = 100). */
export function toIndex(avg: number | null | undefined): number | null {
  if (typeof avg !== "number" || Number.isNaN(avg)) return null;
  return Math.round(((Math.max(1, Math.min(5, avg)) - 1) / 4) * 100);
}

/** Private 1:1 conversation ("counselling session") with the person's manager or the CEO. */
export const CARE_WITH = ["manager", "ceo"] as const;
export const CARE_MODES = ["in_person", "call", "video"] as const;
export const CARE_WHEN = ["Today", "In the next 2 days", "This week", "Any time"] as const;
export const careInput = z.object({
  with: z.enum(CARE_WITH), mode: z.enum(CARE_MODES), when: z.enum(CARE_WHEN),
  note: z.string().trim().max(500).optional(),
}).strict();
/** Closed or cancelled conversations are erased this many days after they close. */
export const CARE_RETENTION_DAYS = 90;
