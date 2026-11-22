import { Router } from "express";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { wrap } from "./util";
import { need, istDate, monthRange, addDays } from "../lib/routeHelpers";
import { MIN_ANONYMOUS_RESPONSES, RESIGNATION_REASONS, shouldShowResults } from "../../shared/hr/misc";
import { attritionOver, bucketOf, daysBetween, median, monthsIn, rangeBuckets, resolveRange, suppressSmall } from "../../shared/hr/dashboard";
import type { SalaryResult } from "../../shared/hr/payroll";
import { toIndex } from "../../shared/hr/buzz";

/**
 * Admin dashboards. People and culture need dashboard.people (HR admin); finance needs dashboard.finance (HR admin or finance).
 * Everything returned is a count or a total. Anything built from anonymous answers or small groups follows the 5+ rule.
 */
const r = Router();
const S = schema;
const dayOf = (d: string | Date) => (typeof d === "string" ? d.slice(0, 10) : istDate(d));
const startOf = (d: string) => new Date(d + "T00:00:00+05:30");
const endOf = (d: string) => new Date(d + "T23:59:59.999+05:30");
/** The window and chart buckets for a request: ?range=7d|30d|90d|12m|fy|custom&from=&to= */
function windowOf(req: { query: Record<string, unknown> }) {
  const today = istDate(), w = resolveRange(req.query, today), { grain, buckets } = rangeBuckets(w.from, w.to);
  return { today, ...w, grain, buckets, days: daysBetween(w.from, w.to), range: { preset: w.preset, from: w.from, to: w.to, grain } };
}

r.get("/dashboard/people", wrap(async (req, res) => {
  need(req, "dashboard.people");
  const W = windowOf(req), { today, buckets } = W, first = W.from, end = W.to;
  const emps = await db.select({ id: S.employees.id, joiningDate: S.employees.joiningDate, status: S.employees.status, lastWorkingDay: S.employees.lastWorkingDay,
    departmentId: S.employees.departmentId, locationId: S.employees.locationId, employmentType: S.employees.employmentType, gender: S.employees.gender }).from(S.employees);
  const depts = new Map((await db.select({ id: S.departments.id, name: S.departments.name }).from(S.departments)).map((d) => [d.id, d.name]));
  const locs = new Map((await db.select({ id: S.locations.id, name: S.locations.name }).from(S.locations)).map((d) => [d.id, d.name]));
  const exitDay = (e: (typeof emps)[number]) => (e.status === "exited" ? e.lastWorkingDay : null);
  const onRoll = (e: (typeof emps)[number], day: string) => e.joiningDate <= day && !(exitDay(e) && exitDay(e)! < day);
  const current = emps.filter((e) => e.status !== "exited");

  const resigns = await db.select({ employeeId: S.resignations.employeeId, status: S.resignations.status, cat: S.resignations.reasonCategory, createdAt: S.resignations.createdAt })
    .from(S.resignations).where(and(gte(S.resignations.createdAt, startOf(first)), lte(S.resignations.createdAt, endOf(end))));
  const voluntary = new Set(resigns.filter((x) => x.status !== "withdrawn").map((x) => x.employeeId));

  const trend = buckets.map(({ key, label, from, to }) => {
    const exits = emps.filter((e) => { const d = exitDay(e); return !!d && d >= from && d <= to; });
    return {
      key, label, headcount: emps.filter((e) => onRoll(e, to > today ? today : to)).length,
      joiners: emps.filter((e) => e.joiningDate >= from && e.joiningDate <= to).length,
      exits: exits.length, voluntaryExits: exits.filter((e) => voluntary.has(e.id)).length,
      resignations: resigns.filter((x) => bucketOf(buckets, dayOf(x.createdAt)) === key && x.status !== "withdrawn").length,
    };
  });
  const reasonCounts: Record<string, number> = {};
  for (const x of resigns) if (x.status !== "withdrawn") { const k = x.cat ?? "not_given"; reasonCounts[k] = (reasonCounts[k] ?? 0) + 1; }
  const reasonLabel = (k: string) => k === "_small" ? "Other reasons" : k === "not_given" ? "Not given" : RESIGNATION_REASONS.find((x) => x.key === k)?.label ?? k;
  const totalResigns = Object.values(reasonCounts).reduce((a, b) => a + b, 0);

  const group = (key: (e: (typeof emps)[number]) => string) => { const m: Record<string, number> = {}; for (const e of current) { const k = key(e); m[k] = (m[k] ?? 0) + 1; } return Object.entries(m).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count); };

  // Leave: approved days per month, by type.
  const types = new Map((await db.select({ id: S.leaveTypes.id, name: S.leaveTypes.name }).from(S.leaveTypes)).map((t) => [t.id, t.name]));
  const leaves = await db.select({ typeId: S.leaveRequests.leaveTypeId, from: S.leaveRequests.fromDate, days2: S.leaveRequests.days2, status: S.leaveRequests.status })
    .from(S.leaveRequests).where(and(gte(S.leaveRequests.fromDate, first), lte(S.leaveRequests.fromDate, end)));
  const leaveTypeNames = [...new Set(leaves.filter((l) => l.status === "approved").map((l) => types.get(l.typeId) ?? "Other"))];
  const leaveTrend = buckets.map(({ key }) => {
    const row: Record<string, number | string> = { key };
    for (const t of leaveTypeNames) row[t] = leaves.filter((l) => l.status === "approved" && bucketOf(buckets, l.from) === key && (types.get(l.typeId) ?? "Other") === t).reduce((a, l) => a + l.days2, 0) / 2;
    return row;
  });

  // Attendance: share of people on the rolls who started their day at least once on an average working day (punch-in days / people).
  const punches = await db.select({ day: sql<string>`to_char(${S.attendancePunches.workDate}, 'YYYY-MM-DD')`, days: sql<number>`count(distinct (${S.attendancePunches.employeeId}, ${S.attendancePunches.workDate}))::int`, remote: sql<number>`count(*) filter (where ${S.attendancePunches.withinOffice} = false)::int` })
    .from(S.attendancePunches).where(and(eq(S.attendancePunches.kind, "in"), gte(S.attendancePunches.workDate, first), lte(S.attendancePunches.workDate, end))).groupBy(sql`1`);
  const attendance = buckets.map(({ key }) => {
    const ps = punches.filter((x) => bucketOf(buckets, x.day) === key), days = ps.reduce((a, x) => a + x.days, 0), hc = trend.find((t) => t.key === key)!.headcount;
    return { key, punchDays: days, perPerson: hc ? Math.round((days / hc) * 10) / 10 : 0, outsideOffice: ps.reduce((a, x) => a + x.remote, 0) };
  });
  const [inToday] = await db.select({ n: sql<number>`count(distinct ${S.attendancePunches.employeeId})::int` }).from(S.attendancePunches).where(and(eq(S.attendancePunches.workDate, today), eq(S.attendancePunches.kind, "in")));
  const [onLeave] = await db.select({ n: sql<number>`count(distinct ${S.leaveRequests.employeeId})::int` }).from(S.leaveRequests)
    .where(and(eq(S.leaveRequests.status, "approved"), sql`${S.leaveRequests.fromDate} <= ${today}`, gte(S.leaveRequests.toDate, today)));
  const [pendingLeave] = await db.select({ n: sql<number>`count(*)::int` }).from(S.leaveRequests).where(eq(S.leaveRequests.status, "pending"));
  const [openPips] = await db.select({ n: sql<number>`count(*)::int` }).from(S.pips).where(inArray(S.pips.status, ["active", "extended"]));

  // Hiring.
  const cands = await db.select({ status: S.candidates.status, createdAt: S.candidates.createdAt }).from(S.candidates);
  const pipeline = ["new", "offered", "accepted", "joined", "declined"].map((s) => ({ status: s, count: cands.filter((c) => c.status === s).length }));
  const offers = await db.select({ createdAt: S.letters.createdAt }).from(S.letters).where(and(inArray(S.letters.type, ["offer_short", "offer_full"]), gte(S.letters.createdAt, startOf(first)), lte(S.letters.createdAt, endOf(end))));
  const hiring = buckets.map(({ key }) => ({ key, candidates: cands.filter((c) => bucketOf(buckets, dayOf(c.createdAt)) === key).length, offers: offers.filter((o) => bucketOf(buckets, dayOf(o.createdAt)) === key).length }));

  const avgHc = trend.length ? trend.reduce((a, t) => a + t.headcount, 0) / trend.length : 0;
  res.json({
    asOf: today, range: W.range,
    kpis: {
      active: current.filter((e) => e.status === "active").length, onNotice: current.filter((e) => e.status === "notice").length,
      interns: current.filter((e) => e.employmentType === "intern").length, inToday: inToday?.n ?? 0, onLeaveToday: onLeave?.n ?? 0,
      pendingLeave: pendingLeave?.n ?? 0, openPips: openPips?.n ?? 0,
      exits: trend.reduce((a, t) => a + t.exits, 0), joiners: trend.reduce((a, t) => a + t.joiners, 0),
      attritionPct: attritionOver(trend.reduce((a, t) => a + t.exits, 0), avgHc, W.days), voluntaryAttritionPct: attritionOver(trend.reduce((a, t) => a + t.voluntaryExits, 0), avgHc, W.days),
    },
    trend,
    resignationReasons: { total: totalResigns, hidden: totalResigns > 0 && totalResigns < MIN_ANONYMOUS_RESPONSES, rows: totalResigns >= MIN_ANONYMOUS_RESPONSES ? suppressSmall(reasonCounts).map((x) => ({ reason: reasonLabel(x.key), count: x.count })) : [] },
    byDepartment: group((e) => (e.departmentId && depts.get(e.departmentId)) || "No department"),
    byLocation: group((e) => (e.locationId && locs.get(e.locationId)) || "No location"),
    byType: group((e) => e.employmentType ?? "full_time"),
    leave: { types: leaveTypeNames, trend: leaveTrend },
    attendance,
    hiring: { pipeline, trend: hiring },
  });
}));

r.get("/dashboard/finance", wrap(async (req, res) => {
  need(req, "dashboard.finance");
  const W = windowOf(req), today = W.today, months = monthsIn(W.from, W.to);
  const runs = await db.select({ id: S.payrollRuns.id, month: S.payrollRuns.month, status: S.payrollRuns.status, snap: S.payrollRuns.rulesSnapshot }).from(S.payrollRuns).where(inArray(S.payrollRuns.month, months));
  const slips = runs.length ? await db.select({ runId: S.payslips.runId, result: S.payslips.result, net: S.payslips.netPayPaise }).from(S.payslips).where(inArray(S.payslips.runId, runs.map((x) => x.id))) : [];
  const sum = (ls: { amount: number }[] | undefined) => (ls ?? []).reduce((a, l) => a + l.amount, 0);
  const payroll = months.map((m) => {
    const run = runs.find((x) => x.month === m);
    const ss = run ? slips.filter((s) => s.runId === run.id).map((s) => s.result as SalaryResult) : [];
    const gross = ss.reduce((a, s) => a + s.grossPaidPaise, 0), employer = ss.reduce((a, s) => a + sum(s.employerContributions), 0);
    return {
      month: m, status: run ? ((run.snap as { imported?: boolean })?.imported ? "imported" : run.status) : "none", payslips: ss.length,
      grossPaise: gross, netPaise: ss.reduce((a, s) => a + s.netPayPaise, 0), deductionsPaise: ss.reduce((a, s) => a + s.totalDeductionsPaise, 0),
      employerPaise: employer, costPaise: gross + employer + ss.reduce((a, s) => a + s.reimbursementsPaise, 0),
      medianGrossPaise: median(ss.map((s) => s.grossPaidPaise)),
    };
  });
  const last = [...payroll].reverse().find((p) => p.payslips > 0) ?? null;
  const lastRun = last ? runs.find((x) => x.month === last.month)! : null;
  const breakdown: Record<string, { name: string; amount: number; kind: string }> = {};
  if (lastRun) for (const s of slips.filter((x) => x.runId === lastRun.id)) {
    const res2 = s.result as SalaryResult;
    for (const [kind, ls] of [["deduction", res2.deductions], ["employer", res2.employerContributions]] as const) for (const l of ls ?? []) {
      const k = `${kind}:${l.code}`; breakdown[k] = breakdown[k] ?? { name: l.name, amount: 0, kind }; breakdown[k].amount += l.amount;
    }
  }
  // Current salary bill from compensation (latest record per active employee).
  const comps = await db.execute(sql`select distinct on (c.employee_id) c.employee_id, c.monthly_gross_paise from hr_compensation c join hr_employees e on e.id = c.employee_id where e.status <> 'exited' and c.effective_from <= ${today} order by c.employee_id, c.effective_from desc`);
  const grossList = (comps.rows as { monthly_gross_paise: number }[]).map((x) => Number(x.monthly_gross_paise));

  const claims = await db.select({ month: S.reimbClaims.month, category: S.reimbClaims.category, status: S.reimbClaims.status, amount: S.reimbClaims.amountPaise }).from(S.reimbClaims).where(inArray(S.reimbClaims.month, months));
  const cats = ["travel", "expense", "technology"];
  const reimb = months.map((m) => { const row: Record<string, number | string> = { month: m }; for (const c of cats) row[c] = claims.filter((x) => x.month === m && x.category === c && ["approved", "paid"].includes(x.status)).reduce((a, x) => a + x.amount, 0); return row; });
  const [pending] = await db.select({ n: sql<number>`count(*)::int`, amt: sql<number>`coalesce(sum(${S.reimbClaims.amountPaise}),0)::bigint` }).from(S.reimbClaims).where(inArray(S.reimbClaims.status, ["submitted", "verified", "manager_approved"]));
  const [toPay] = await db.select({ n: sql<number>`count(*)::int`, amt: sql<number>`coalesce(sum(${S.reimbClaims.amountPaise}),0)::bigint` }).from(S.reimbClaims).where(eq(S.reimbClaims.status, "approved"));

  res.json({
    asOf: today, range: { ...W.range, grain: "month" },
    kpis: {
      lastMonth: last?.month ?? null, lastCostPaise: last?.costPaise ?? 0, lastNetPaise: last?.netPaise ?? 0, lastPayslips: last?.payslips ?? 0,
      monthlyGrossBillPaise: grossList.reduce((a, b) => a + b, 0), annualisedCostPaise: (last?.costPaise ?? 0) * 12,
      medianGrossPaise: grossList.length >= MIN_ANONYMOUS_RESPONSES ? median(grossList) : null, peopleWithSalary: grossList.length,
      claimsPending: pending?.n ?? 0, claimsPendingPaise: Number(pending?.amt ?? 0), claimsToPay: toPay?.n ?? 0, claimsToPayPaise: Number(toPay?.amt ?? 0),
    },
    payroll: payroll.map((p) => ({ ...p, medianGrossPaise: p.payslips >= MIN_ANONYMOUS_RESPONSES ? p.medianGrossPaise : null })),
    statutory: Object.values(breakdown).sort((a, b) => b.amount - a.amount),
    reimbursements: { categories: cats, trend: reimb },
  });
}));

r.get("/dashboard/culture", wrap(async (req, res) => {
  need(req, "dashboard.people");
  const W = windowOf(req), { today, buckets } = W, first = W.from, end = W.to;
  const since = startOf(first), until = endOf(end);
  const [{ staff }] = await db.select({ staff: sql<number>`count(*)::int` }).from(S.employees).where(inArray(S.employees.status, ["active", "notice"]));

  // Daily active people, only for those who opted in to login_activity. Days with fewer than 5 are shown as "fewer than 5".
  // Daily chart covers the window, or its last 92 days when longer.
  const dauDays = Math.min(W.days, 92), fromD = addDays(end, -(dauDays - 1));
  const daily = await db.select({ day: S.loginDays.day, n: sql<number>`count(*)::int` }).from(S.loginDays).where(and(gte(S.loginDays.day, fromD), lte(S.loginDays.day, end))).groupBy(S.loginDays.day);
  const dau = Array.from({ length: dauDays }, (_, i) => { const d = addDays(fromD, i); const n = daily.find((x) => x.day === d)?.n ?? 0; return { day: d, count: n }; });
  const loginRows = await db.select({ day: S.loginDays.day, employeeId: S.loginDays.employeeId }).from(S.loginDays).where(and(gte(S.loginDays.day, first), lte(S.loginDays.day, end)));
  const consentRows = await db.execute(sql`select count(*)::int as n from (select distinct on (subject_id) status from hr_consent_events where purpose_key = 'login_activity' and subject_id like 'emp_%' order by subject_id, created_at desc) x where status = 'granted'`);
  const optedIn = Number((consentRows.rows[0] as { n: number })?.n ?? 0);

  const posts = await db.select({ createdAt: S.feedPosts.createdAt, by: S.feedPosts.employeeId }).from(S.feedPosts).where(and(gte(S.feedPosts.createdAt, since), lte(S.feedPosts.createdAt, until), sql`${S.feedPosts.deletedAt} is null`));
  const kudos = await db.select({ createdAt: S.kudos.createdAt, by: S.kudos.fromEmployeeId }).from(S.kudos).where(and(gte(S.kudos.createdAt, since), lte(S.kudos.createdAt, until), sql`${S.kudos.deletedAt} is null`));
  const engagement = buckets.map(({ key, label }) => {
    const inB = (d: Date) => bucketOf(buckets, dayOf(d)) === key;
    const p = posts.filter((x) => inB(x.createdAt)), k = kudos.filter((x) => inB(x.createdAt));
    return { key, label, posts: p.length, kudos: k.length, posters: new Set([...p, ...k].map((x) => x.by)).size, activePeople: new Set(loginRows.filter((x) => bucketOf(buckets, x.day) === key).map((x) => x.employeeId)).size };
  });

  // eSAT: overall average of rating answers per survey, only for surveys with 5+ responses.
  const cycles = await db.select().from(S.esatCycles).orderBy(S.esatCycles.createdAt);
  const esat = [] as { title: string; createdAt: string; responses: number; average: number | null; participationPct: number | null }[];
  for (const c of cycles.filter((c) => istDate(c.createdAt) >= first && istDate(c.createdAt) <= end).slice(-12)) {
    const rows = await db.select({ answers: S.esatResponses.answers }).from(S.esatResponses).where(eq(S.esatResponses.cycleId, c.id));
    const ratingIds = new Set((c.questions as { id: string; type: string }[]).filter((q) => q.type === "rating").map((q) => q.id));
    const nums = rows.flatMap((x) => Object.entries(x.answers as Record<string, unknown>).filter(([k, v]) => ratingIds.has(k) && typeof v === "number").map(([, v]) => v as number));
    const show = shouldShowResults(rows.length);
    esat.push({ title: c.title, createdAt: istDate(c.createdAt), responses: rows.length, average: show && nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : null, participationPct: show && staff ? Math.round((rows.length / staff) * 100) : null });
  }
  // Check-in indexes: company-wide, by week. Each index shows only when 5 or more people answered it that week.
  const P = S.pulseResponses;
  const pulse = await db.select({ week: P.week, n: sql<number>`count(*)::int`,
    mood: sql<number | null>`avg(${P.mood})::float`, stress: sql<number | null>`avg(${P.stress})::float`, motivation: sql<number | null>`avg(${P.motivation})::float`,
    nStress: sql<number>`count(${P.stress})::int`, nMotivation: sql<number>`count(${P.motivation})::int` }).from(P).where(and(gte(P.submittedDay, first), lte(P.submittedDay, end))).groupBy(P.week).orderBy(P.week);

  res.json({
    asOf: today, range: W.range, staff, minGroup: MIN_ANONYMOUS_RESPONSES,
    logins: { optedIn, dau: dau.map((d) => ({ day: d.day, count: d.count >= MIN_ANONYMOUS_RESPONSES || d.count === 0 ? d.count : null })), today: (() => { const n = dau.at(-1)?.count ?? 0; return n >= MIN_ANONYMOUS_RESPONSES || n === 0 ? n : null; })() },
    engagement,
    esat,
    pulse: pulse.map((p) => ({ week: p.week, responses: p.n, mood: shouldShowResults(p.n) ? toIndex(p.mood) : null, stress: shouldShowResults(p.nStress) ? toIndex(p.stress) : null, motivation: shouldShowResults(p.nMotivation) ? toIndex(p.motivation) : null })),
  });
}));

export default r;
