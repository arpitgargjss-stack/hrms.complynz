/**
 * Extra fake history so the dashboards have something to show in a local preview: about 25 masked people joining and
 * leaving over the last year, leave, attendance, payroll months, claims, hiring, surveys and posts.
 * No PII: masked names, reserved-domain emails. Refuses anything but a database on this machine.
 * Run: pnpm db:seed:dashboards   (after pnpm db:seed)
 */
import { like } from "drizzle-orm";
import { db, pool, schema as s } from "../db";
import { env } from "../env";
import { computeSalary } from "../../shared/hr/payroll";
import { RULE_PRESETS, TEMPLATE_PRESETS } from "../../shared/hr/presets";
import { lastMonths } from "../../shared/hr/dashboard";
import { isoWeek } from "../../shared/hr/buzz";
import { RESIGNATION_REASONS } from "../../shared/hr/misc";
import { istDate, monthRange, addDays } from "../lib/routeHelpers";

if (env.HR_APP_URL.startsWith("https://hrms.complynz.com")) throw new Error("Refusing to seed demo data on the production host");
const host = new URL(env.DATABASE_URL).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new Error("Refusing to seed: the database is not on this machine");
const TAG = "@dash.demo.invalid";
if ((await db.select({ id: s.employees.id }).from(s.employees).where(like(s.employees.workEmail, `%${TAG}`)).limit(1)).length) { console.log("Dashboard demo data already present."); await pool.end(); process.exit(0); }

let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
const today = istDate(), months = lastMonths(12, today);
const depts = await db.select().from(s.departments);
const locs = await db.select().from(s.locations);
const types = await db.select().from(s.leaveTypes);
const L = [..."ABCDEFGHJKLMNPRSTVY"];

// People: 26 joiners spread over the year, 6 of whom leave.
const people: (typeof s.employees.$inferSelect)[] = [];
for (let i = 0; i < 26; i++) {
  const join = `${months[Math.min(11, Math.floor(i / 2.4))]}-${String(1 + Math.floor(rnd() * 27)).padStart(2, "0")}`;
  const leaves = i % 4 === 1 && i < 22;
  const lwd = leaves ? addDays(join, 60 + Math.floor(rnd() * 150)) : null;
  const exited = !!lwd && lwd < today;
  const [e] = await db.insert(s.employees).values({
    code: `CMPZ8${String(i + 1).padStart(2, "0")}`, workEmail: `d${i + 1}${TAG}`, fullName: `${pick(L)}*** ${pick(L)}****`,
    joiningDate: join, gender: rnd() < 0.45 ? "female" : "male", departmentId: depts.length ? pick(depts).id : null, locationId: locs.length ? pick(locs).id : null,
    employmentType: i % 6 === 5 ? "intern" : "full_time", status: exited ? "exited" : lwd ? "notice" : "active", lastWorkingDay: lwd,
  }).returning();
  people.push(e);
  if (lwd) await db.insert(s.resignations).values({ employeeId: e.id, proposedLastDay: lwd, agreedLastDay: lwd, reason: "Demo reason", reasonCategory: RESIGNATION_REASONS[i % 3 === 0 ? 0 : i % 5].key,
    status: exited ? "completed" : "accepted", createdAt: new Date(addDays(lwd, -30) + "T10:00:00+05:30") });
}
const onRoll = (e: (typeof people)[number], d: string) => e.joiningDate <= d && !(e.lastWorkingDay && e.lastWorkingDay < d);

// Leave and attendance.
for (const e of people) for (const m of months) {
  const { from, to } = monthRange(m);
  if (to > today && from > today) continue;
  if (rnd() < 0.5 && onRoll(e, from) && types.length) { const d = addDays(from, Math.floor(rnd() * 20)); const n = 1 + Math.floor(rnd() * 2); if (d < today) await db.insert(s.leaveRequests).values({ employeeId: e.id, leaveTypeId: pick(types.filter((t) => t.key !== "unpaid")).id, fromDate: d, toDate: addDays(d, n - 1), days2: n * 2, status: "approved" }); }
  const punches = [];
  for (let d = from; d <= to && d <= today; d = addDays(d, 1)) { const wd = new Date(d + "T00:00:00Z").getUTCDay(); if (wd === 0 || wd === 6 || !onRoll(e, d) || rnd() < 0.12) continue; punches.push({ employeeId: e.id, kind: "in", workDate: d, at: new Date(d + "T09:40:00+05:30"), withinOffice: rnd() > 0.15 }); }
  if (punches.length) await db.insert(s.attendancePunches).values(punches);
}

// Payroll: one paid run per finished month without a run yet.
const existingRuns = new Set((await db.select({ month: s.payrollRuns.month }).from(s.payrollRuns)).map((r) => r.month));
const tpl = TEMPLATE_PRESETS[0].components;
const grossOf = new Map(people.map((e, i) => [e.id, (e.employmentType === "intern" ? 15_000 : 30_000 + (i % 7) * 9_000) * 100]));
for (const m of months.slice(0, -1)) {
  if (existingRuns.has(m)) continue;
  const rules = (m >= "2026-10" ? RULE_PRESETS[0] : RULE_PRESETS[1]).rules;
  const [run] = await db.insert(s.payrollRuns).values({ month: m, status: "paid", rulesSnapshot: { demo: true }, createdBy: "demo-seed", lockedBy: "demo-seed", lockedAt: new Date() }).returning();
  const { to } = monthRange(m);
  for (const e of people.filter((p) => onRoll(p, to) || (p.lastWorkingDay && p.lastWorkingDay.slice(0, 7) === m))) {
    const res = computeSalary({ monthlyGrossPaise: grossOf.get(e.id)!, components: tpl, calendarDays: 30, paidDays: 30, rules, pt: { state: "Maharashtra", gender: e.gender, month: m }, tds: { taxDeductedSoFarPaise: 0, monthsRemaining: 6 } });
    await db.insert(s.payslips).values({ runId: run.id, employeeId: e.id, paidDays: 60, calendarDays: 30, result: res, netPayPaise: res.netPayPaise });
  }
}
await db.insert(s.compensation).values(people.filter((e) => e.status !== "exited").map((e) => ({ employeeId: e.id, effectiveFrom: e.joiningDate, monthlyGrossPaise: grossOf.get(e.id)!, components: tpl, createdBy: "demo-seed" })));

// Claims, hiring, posts, kudos, surveys, login days.
for (const m of months) for (let k = 0; k < 3 + Math.floor(rnd() * 5); k++) {
  const e = pick(people); await db.insert(s.reimbClaims).values({ employeeId: e.id, month: m, category: pick(["travel", "expense", "technology"]), amountPaise: (500 + Math.floor(rnd() * 4000)) * 100, expenseDate: `${m}-10`, status: m === months[11] ? pick(["submitted", "verified", "approved"]) : "paid", description: "Demo claim" });
}
for (let i = 0; i < 18; i++) await db.insert(s.candidates).values({ fullName: `${pick(L)}*** ${pick(L)}****`, email: `c${i + 1}${TAG}`, status: pick(["new", "new", "offered", "accepted", "joined", "declined"]), createdBy: "demo-seed", createdAt: new Date(`${pick(months)}-12T10:00:00+05:30`) });
for (const m of months.slice(-6)) {
  const pool6 = people.filter((e) => onRoll(e, `${m}-15`));
  for (let k = 0; k < 4 + Math.floor(rnd() * 8); k++) await db.insert(s.feedPosts).values({ employeeId: pick(pool6).id, kind: "quote", audience: "everyone", quote: "Demo post", createdAt: new Date(`${m}-${String(1 + k).padStart(2, "0")}T11:00:00+05:30`) });
  for (let k = 0; k < 5 + Math.floor(rnd() * 8); k++) { const a = pick(pool6), b = pick(pool6); if (a.id !== b.id) await db.insert(s.kudos).values({ fromEmployeeId: a.id, toEmployeeId: b.id, value: "ownership", message: "Demo thank-you", createdAt: new Date(`${m}-${String(2 + k).padStart(2, "0")}T12:00:00+05:30`) }); }
}
const qs = [{ id: "overall", type: "rating", text: "How happy are you at work?" }, { id: "growth", type: "rating", text: "Do you see yourself growing here?" }];
for (const [title, mm, avg] of [["Q1 check-in", months[2], 3.6], ["Q2 check-in", months[5], 3.9], ["Q3 check-in", months[8], 4.1]] as const) {
  const [c] = await db.insert(s.esatCycles).values({ title, questions: qs, status: "closed", createdAt: new Date(`${mm}-05T10:00:00+05:30`) }).returning();
  for (let k = 0; k < 12; k++) await db.insert(s.esatResponses).values({ cycleId: c.id, answers: { overall: Math.max(1, Math.min(5, Math.round(avg + rnd() * 1.6 - 0.8))), growth: Math.max(1, Math.min(5, Math.round(avg + rnd() * 1.6 - 0.9))) }, submittedDay: `${mm}-08` });
}
for (let w = 0; w < 20; w++) {
  const d = addDays(today, -7 * (19 - w)); const week = isoWeek(d);
  for (let k = 0; k < 6 + Math.floor(rnd() * 8); k++) { const m = (b: number) => Math.max(1, Math.min(5, Math.round(b + w * 0.03 + rnd() * 2 - 1))); await db.insert(s.pulseResponses).values({ week, mood: m(3.4), stress: m(3.0), motivation: m(3.6), submittedDay: d }); }
}
const consenting = people.filter((e) => e.status !== "exited" && rnd() < 0.8);
await db.insert(s.consentEvents).values(consenting.map((e) => ({ subjectId: "emp_" + e.id, purposeKey: "login_activity", status: "granted", noticeVersion: "login-v1", source: "demo-seed" })));
const days = [];
for (let d = addDays(today, -90); d <= today; d = addDays(d, 1)) { const wd = new Date(d + "T00:00:00Z").getUTCDay(); for (const e of consenting) if (onRoll(e, d) && rnd() < (wd === 0 || wd === 6 ? 0.1 : 0.75)) days.push({ employeeId: e.id, day: d }); }
for (let i = 0; i < days.length; i += 500) await db.insert(s.loginDays).values(days.slice(i, i + 500)).onConflictDoNothing();

console.log(`Dashboard demo data added: ${people.length} people, ${days.length} login days.`);
await pool.end();
