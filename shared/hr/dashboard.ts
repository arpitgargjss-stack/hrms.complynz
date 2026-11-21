import { MIN_ANONYMOUS_RESPONSES } from "./misc";

/** The last n months ending with the month of `today` (YYYY-MM-DD), oldest first. */
export function lastMonths(n: number, today: string): string[] {
  let y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const out: string[] = [];
  for (let i = 0; i < n; i++) { out.unshift(`${y}-${String(m).padStart(2, "0")}`); m--; if (m === 0) { m = 12; y--; } }
  return out;
}

/** Annualised attrition: exits in the window over the average headcount, as a percentage with one decimal. */
export function attritionPct(exits: number, headcounts: number[]): number | null {
  const avg = headcounts.length ? headcounts.reduce((a, b) => a + b, 0) / headcounts.length : 0;
  if (!avg) return null;
  return Math.round((exits / avg) * (12 / headcounts.length) * 1000) / 10;
}

/** Group counts and hide any group smaller than the anonymity minimum (merged into "Other (fewer than 5)"). */
export function suppressSmall(counts: Record<string, number>, min = MIN_ANONYMOUS_RESPONSES): { key: string; count: number }[] {
  const out: { key: string; count: number }[] = [];
  let small = 0;
  for (const [key, count] of Object.entries(counts)) { if (count >= min) out.push({ key, count }); else small += count; }
  out.sort((a, b) => b.count - a.count);
  if (small) out.push({ key: "_small", count: small });
  return out;
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

// ---------------------------------------------------------------- date ranges
export type RangePreset = "7d" | "30d" | "90d" | "12m" | "fy" | "custom";
export const RANGE_PRESETS: [RangePreset, string][] = [["7d", "Last 7 days"], ["30d", "Last 30 days"], ["90d", "Last 90 days"], ["12m", "Last 12 months"], ["fy", "This financial year"], ["custom", "Custom"]];
export type Bucket = { key: string; from: string; to: string; label: string };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const plus = (d: string, n: number) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000) + 1;
const isoDay = /^\d{4}-\d{2}-\d{2}$/;

/** Turn a preset or custom dates into a from/to window (inclusive, never after today, at most 3 years). Defaults to the last 12 months. */
export function resolveRange(q: { range?: unknown; from?: unknown; to?: unknown }, today: string): { preset: RangePreset; from: string; to: string } {
  const preset = (RANGE_PRESETS.some(([k]) => k === q.range) ? q.range : "12m") as RangePreset;
  if (preset === "7d") return { preset, from: plus(today, -6), to: today };
  if (preset === "30d") return { preset, from: plus(today, -29), to: today };
  if (preset === "90d") return { preset, from: plus(today, -89), to: today };
  if (preset === "fy") { const y = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 4 ? 1 : 0); return { preset, from: `${y}-04-01`, to: today }; }
  if (preset === "custom" && typeof q.from === "string" && typeof q.to === "string" && isoDay.test(q.from) && isoDay.test(q.to)) {
    let from = q.from, to = q.to;
    if (from > to) [from, to] = [to, from];
    if (to > today) to = today;
    if (from > to) from = to;
    if (daysBetween(from, to) > 1096) from = plus(to, -1095);
    return { preset, from, to };
  }
  return { preset: "12m", from: `${lastMonths(12, today)[0]}-01`, to: today };
}

/** Chart buckets for a window: days up to 45 days, weeks (from Monday) up to 6 months, months beyond. Edge buckets are clipped to the window. */
export function rangeBuckets(from: string, to: string): { grain: "day" | "week" | "month"; buckets: Bucket[] } {
  const n = daysBetween(from, to), out: Bucket[] = [];
  const dl = (d: string) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}`;
  if (n <= 45) { for (let d = from; d <= to; d = plus(d, 1)) out.push({ key: d, from: d, to: d, label: dl(d) }); return { grain: "day", buckets: out }; }
  if (n <= 183) {
    let start = plus(from, -((new Date(from + "T00:00:00Z").getUTCDay() + 6) % 7));
    for (; start <= to; start = plus(start, 7)) { const f = start < from ? from : start, e = plus(start, 6) > to ? to : plus(start, 6); out.push({ key: start, from: f, to: e, label: dl(f) }); }
    return { grain: "week", buckets: out };
  }
  let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
  for (;;) {
    const mk = `${y}-${String(m).padStart(2, "0")}`, f0 = `${mk}-01`; if (f0 > to) break;
    const last = `${mk}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
    out.push({ key: mk, from: f0 < from ? from : f0, to: last > to ? to : last, label: `${MON[m - 1]} ${String(y).slice(2)}` });
    m++; if (m === 13) { m = 1; y++; }
  }
  return { grain: "month", buckets: out };
}
export const bucketOf = (bs: Bucket[], day: string) => bs.find((b) => day >= b.from && day <= b.to)?.key ?? null;
/** Calendar months a window touches, for data that only exists by month (payroll, claims). */
export function monthsIn(from: string, to: string): string[] {
  const out: string[] = []; let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
  while (`${y}-${String(m).padStart(2, "0")}` <= to.slice(0, 7)) { out.push(`${y}-${String(m).padStart(2, "0")}`); m++; if (m === 13) { m = 1; y++; } }
  return out;
}
/** Attrition over any window, annualised: exits over the average headcount, scaled to a year. */
export function attritionOver(exits: number, avgHeadcount: number, days: number): number | null {
  if (!avgHeadcount || days <= 0) return null;
  return Math.round((exits / avgHeadcount) * (365 / days) * 1000) / 10;
}
