import { useState } from "react";
import { RANGE_PRESETS, type RangePreset } from "../../../shared/hr/dashboard";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Card, ErrorNote, Page, inr } from "../lib/ui";
import { BarChart, LineChart, RankBars, Stat } from "../lib/charts";

type Me = { roles: string[] };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const mLabel = (m: string) => MON[Number(m.slice(5, 7)) - 1] + " " + m.slice(2, 4);
const dLabel = (d: string) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}`;
/** Rupees in lakh or thousand, for chart axes. */
const short = (p: number) => { const r = p / 100; return r >= 1e7 ? `₹${(r / 1e7).toFixed(1)}Cr` : r >= 1e5 ? `₹${(r / 1e5).toFixed(1)}L` : r >= 1e3 ? `₹${Math.round(r / 1e3)}k` : `₹${Math.round(r)}`; };
const rupees = (p: number) => inr(p).replace(/\.00$/, "");
const TYPE: Record<string, string> = { full_time: "Full time", intern: "Intern", contract: "Contract", part_time: "Part time", consultant: "Consultant" };

type Range = { preset: RangePreset; from: string; to: string; grain?: "day" | "week" | "month" };
const qs = (r: Range) => (r.preset === "custom" ? `?range=custom&from=${r.from}&to=${r.to}` : `?range=${r.preset}`);
const fmtDay = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const per = (g?: string) => (g === "day" ? "day" : g === "week" ? "week" : "month");
type People = {
  asOf: string; range: Range;
  kpis: { active: number; onNotice: number; interns: number; inToday: number; onLeaveToday: number; pendingLeave: number; openPips: number; attritionPct: number | null; voluntaryAttritionPct: number | null; joiners: number; exits: number };
  trend: { key: string; label: string; headcount: number; joiners: number; exits: number; voluntaryExits: number; resignations: number }[];
  resignationReasons: { total: number; hidden: boolean; rows: { reason: string; count: number }[] };
  byDepartment: { name: string; count: number }[]; byLocation: { name: string; count: number }[]; byType: { name: string; count: number }[];
  leave: { types: string[]; trend: Record<string, number | string>[] };
  attendance: { key: string; punchDays: number; perPerson: number; outsideOffice: number }[];
  hiring: { pipeline: { status: string; count: number }[]; trend: { key: string; candidates: number; offers: number }[] };
};
type Finance = {
  asOf: string; range: Range;
  kpis: { lastMonth: string | null; lastCostPaise: number; lastNetPaise: number; lastPayslips: number; monthlyGrossBillPaise: number; annualisedCostPaise: number; medianGrossPaise: number | null; peopleWithSalary: number; claimsPending: number; claimsPendingPaise: number; claimsToPay: number; claimsToPayPaise: number };
  payroll: { month: string; status: string; payslips: number; grossPaise: number; netPaise: number; deductionsPaise: number; employerPaise: number; costPaise: number; medianGrossPaise: number | null }[];
  statutory: { name: string; amount: number; kind: string }[];
  reimbursements: { categories: string[]; trend: Record<string, number | string>[] };
};
type Culture = {
  asOf: string; range: Range; staff: number; minGroup: number;
  logins: { optedIn: number; dau: { day: string; count: number | null }[]; today: number | null };
  engagement: { key: string; label: string; posts: number; kudos: number; posters: number; activePeople: number }[];
  esat: { title: string; createdAt: string; responses: number; average: number | null; participationPct: number | null }[];
  pulse: { week: string; responses: number; mood: number | null; stress: number | null; motivation: number | null }[];
};

function PeopleTab({ range }: { range: Range }) {
  const q = useQuery({ queryKey: ["dash", "people", range], queryFn: () => api<People>("/dashboard/people" + qs(range)), placeholderData: (p) => p });
  if (q.error) return <ErrorNote error={q.error} />;
  if (!q.data) return <Card><p>Loading…</p></Card>;
  const d = q.data, k = d.kpis, labels = d.trend.map((t) => t.label), g = per(d.range.grain);
  const pct = (v: number | null) => (v == null ? "-" : `${v}%`);
  return <>
    <div className="dash-kpis">
      <Stat label="Active employees" value={k.active} sub={`${k.interns} interns`} />
      <Stat label="In today" value={k.inToday} sub={`${k.onLeaveToday} on leave`} />
      <Stat label="On notice" value={k.onNotice} />
      <Stat label="Joined and left in this period" value={`${k.joiners} / ${k.exits}`} sub="Joined / left" />
      <Stat label="Attrition in this period" value={pct(k.attritionPct)} sub={`Annualised. Voluntary ${pct(k.voluntaryAttritionPct)}`} />
      <Stat label="Leave requests waiting" value={<Link href="/leave">{k.pendingLeave}</Link>} />
      <Stat label="Open PIPs" value={k.openPips} />
    </div>
    <div className="dash-grid">
      <Card><LineChart title="Headcount" labels={labels} series={[{ name: "Headcount", values: d.trend.map((t) => t.headcount) }]} note={`People on the rolls at the end of each ${g}.`} /></Card>
      <Card><BarChart title="Joiners and exits" labels={labels} series={[{ name: "Joined", values: d.trend.map((t) => t.joiners) }, { name: "Left", values: d.trend.map((t) => t.exits) }]} /></Card>
      <Card><BarChart title="Resignations submitted" labels={labels} series={[{ name: "Resignations", values: d.trend.map((t) => t.resignations) }]} note="Withdrawn resignations are left out." /></Card>
      <Card><RankBars title="Why people resign, in this period" rows={d.resignationReasons.rows.map((r) => ({ name: r.reason, value: r.count }))}
        note={d.resignationReasons.hidden ? `Reasons appear once ${5} or more resignations are on record, so no one can be singled out (${d.resignationReasons.total} so far).` : "Reasons shared by fewer than 5 people are grouped under Other reasons."} /></Card>
      <Card><BarChart title="Leave taken (days)" labels={labels} stack series={d.leave.types.slice(0, 4).map((t) => ({ name: t, values: d.leave.trend.map((r) => Number(r[t] ?? 0)) }))} note={`Approved leave, by the ${g} it starts.`} /></Card>
      <Card><BarChart title="Attendance: days started per person" labels={labels} series={[{ name: "Days per person", values: d.attendance.map((a) => a.perPerson) }]} fmt={(n) => (Math.round(n * 10) / 10).toString()} note="Start-my-day punches divided by headcount." /></Card>
      <Card><BarChart title="Hiring" labels={labels} series={[{ name: "Candidates added", values: d.hiring.trend.map((h) => h.candidates) }, { name: "Offers made", values: d.hiring.trend.map((h) => h.offers) }]} /></Card>
      <Card><RankBars title="Hiring pipeline now" rows={d.hiring.pipeline.map((p) => ({ name: p.status[0].toUpperCase() + p.status.slice(1), value: p.count }))} /></Card>
      <Card><RankBars title="By department" rows={d.byDepartment.map((r) => ({ name: r.name, value: r.count }))} /></Card>
      <Card><RankBars title="By office" rows={d.byLocation.map((r) => ({ name: r.name, value: r.count }))} />
        <div style={{ marginTop: 16 }}><RankBars title="By type" rows={d.byType.map((r) => ({ name: TYPE[r.name] ?? r.name, value: r.count }))} /></div></Card>
    </div>
  </>;
}

function FinanceTab({ range }: { range: Range }) {
  const q = useQuery({ queryKey: ["dash", "finance", range], queryFn: () => api<Finance>("/dashboard/finance" + qs(range)), placeholderData: (p) => p });
  if (q.error) return <ErrorNote error={q.error} />;
  if (!q.data) return <Card><p>Loading…</p></Card>;
  const d = q.data, k = d.kpis, labels = d.payroll.map((p) => mLabel(p.month));
  const CAT: Record<string, string> = { travel: "Travel", expense: "Expenses", technology: "Technology" };
  return <>
    <p className="k" style={{ marginTop: -4 }}>Payroll and claims are monthly, so this tab shows every month the chosen dates touch.</p>
    <div className="dash-kpis">
      <Stat label={k.lastMonth ? `Payroll cost, ${mLabel(k.lastMonth)}` : "Payroll cost"} value={rupees(k.lastCostPaise)} sub={`${k.lastPayslips} payslips, net ${rupees(k.lastNetPaise)}`} />
      <Stat label="Annual run rate" value={short(k.annualisedCostPaise)} sub="Last month's cost x 12" />
      <Stat label="Monthly gross on current salaries" value={rupees(k.monthlyGrossBillPaise)} sub={`${k.peopleWithSalary} people`} />
      <Stat label="Median monthly gross" value={k.medianGrossPaise == null ? "-" : rupees(k.medianGrossPaise)} sub={k.medianGrossPaise == null ? "Shown at 5 or more people" : undefined} />
      <Stat label="Claims waiting for approval" value={<Link href="/reimbursements">{k.claimsPending}</Link>} sub={rupees(k.claimsPendingPaise)} />
      <Stat label="Approved claims to pay" value={k.claimsToPay} sub={rupees(k.claimsToPayPaise)} />
    </div>
    <div className="dash-grid">
      <Card><BarChart title="Payroll cost by month" labels={labels} stack fmt={short}
        series={[{ name: "Net pay", values: d.payroll.map((p) => p.netPaise) }, { name: "Deductions", values: d.payroll.map((p) => p.deductionsPaise) }, { name: "Employer PF and ESI", values: d.payroll.map((p) => p.employerPaise) }]}
        note="Locked, paid and imported months. Net pay plus deductions is gross." /></Card>
      <Card><LineChart title="Median monthly gross (salary trend)" labels={labels} fmt={short} series={[{ name: "Median gross", values: d.payroll.map((p) => p.medianGrossPaise) }]} note="Months with fewer than 5 payslips are hidden." /></Card>
      <Card><RankBars title={k.lastMonth ? `Deductions and contributions, ${mLabel(k.lastMonth)}` : "Deductions and contributions"} rows={d.statutory.map((s) => ({ name: s.kind === "employer" && !/employer/i.test(s.name) ? `${s.name} (employer)` : s.name, value: s.amount }))} fmt={rupees} /></Card>
      <Card><BarChart title="Reimbursements approved" labels={labels} stack fmt={short} series={d.reimbursements.categories.map((c) => ({ name: CAT[c] ?? c, values: d.reimbursements.trend.map((r) => Number(r[c] ?? 0)) }))} /></Card>
      <Card><h2>Months</h2><table className="t"><thead><tr><th>Month</th><th>Status</th><th style={{ textAlign: "right" }}>Payslips</th><th style={{ textAlign: "right" }}>Gross</th><th style={{ textAlign: "right" }}>Net</th><th style={{ textAlign: "right" }}>Cost</th></tr></thead>
        <tbody>{[...d.payroll].reverse().map((p) => <tr key={p.month}><td>{mLabel(p.month)}</td><td>{p.status === "none" ? "Not run" : p.status[0].toUpperCase() + p.status.slice(1)}</td><td style={{ textAlign: "right" }}>{p.payslips || "-"}</td><td style={{ textAlign: "right" }}>{p.payslips ? rupees(p.grossPaise) : "-"}</td><td style={{ textAlign: "right" }}>{p.payslips ? rupees(p.netPaise) : "-"}</td><td style={{ textAlign: "right" }}>{p.payslips ? rupees(p.costPaise) : "-"}</td></tr>)}</tbody></table>
        <p className="k"><Link href="/payroll">Open payroll</Link> to run, lock or import a month.</p></Card>
    </div>
  </>;
}

const FEEL: [keyof Culture["pulse"][number], string][] = [["stress", "Stressometer (100 = calm)"], ["mood", "Happy Index"], ["motivation", "Motivation Index"]];
function FeelTab({ range }: { range: Range }) {
  const q = useQuery({ queryKey: ["dash", "culture", range], queryFn: () => api<Culture>("/dashboard/culture" + qs(range)), placeholderData: (p) => p });
  if (q.error) return <ErrorNote error={q.error} />;
  if (!q.data) return <Card><p>Loading…</p></Card>;
  const d = q.data, labels = d.engagement.map((e) => e.label);
  const latestOf = (k: keyof Culture["pulse"][number]) => [...d.pulse].reverse().find((p) => p[k] != null);
  const prevOf = (k: keyof Culture["pulse"][number], week?: string) => [...d.pulse].reverse().find((p) => p[k] != null && p.week !== week);
  const one = (n: number) => String(Math.round(n * 10) / 10);
  const latestEsat = d.esat.filter((e) => e.average != null).at(-1);
  const trend = (k: keyof Culture["pulse"][number]) => { const l = latestOf(k), pr = prevOf(k, l?.week); if (!l || !pr) return undefined; const diff = Number(l[k]) - Number(pr[k]); return diff === 0 ? "Same as the week before" : `${diff > 0 ? "Up" : "Down"} ${Math.abs(diff)} on the week before`; };
  return <>
    <p className="k" style={{ marginTop: -4 }}>From the anonymous weekly check-in on everyone's Home page, as indexes out of 100 (higher is better, so a high Stressometer means calm). Weeks with fewer than {d.minGroup} answers stay hidden, so no one can be picked out.</p>
    <div className="dash-kpis">
      {FEEL.map(([k, l]) => { const x = latestOf(k); return <Stat key={k} label={l} value={x ? `${x[k]} / 100` : "-"} sub={x ? trend(k) ?? `Week ${x.week.slice(-2)}, ${x.responses} answers` : `Shown at ${d.minGroup} or more answers`} />; })}
      <Stat label="Latest eSAT survey" value={latestEsat ? `${latestEsat.average} / 5` : "-"} sub={latestEsat ? `${latestEsat.title}, ${latestEsat.participationPct}% answered` : `Shown at ${d.minGroup} or more responses`} />
    </div>
    <div className="dash-grid">
      <Card><LineChart title="How people feel, week by week" labels={d.pulse.map((p) => `W${p.week.slice(-2)}`)} max={100}
        series={FEEL.map(([k, l]) => ({ name: l, values: d.pulse.map((p) => p[k] as number | null) }))} note="Stressometer, Happy Index and Motivation Index, out of 100. A gap means too few answers that week." /></Card>
      <Card><LineChart title="eSAT average by survey" labels={d.esat.map((e) => e.title.length > 14 ? e.title.slice(0, 13) + "…" : e.title)} max={5} fmt={one} series={[{ name: "Average rating", values: d.esat.map((e) => e.average) }]}
        note="Average of all rating questions. Surveys with fewer than 5 responses are hidden." /></Card>
      <Card><BarChart title="Kudos and posts" labels={labels} series={[{ name: "Kudos", values: d.engagement.map((e) => e.kudos) }, { name: "Feed posts", values: d.engagement.map((e) => e.posts) }]} note="Thank-yous and sharing are a sign people enjoy working together." /></Card>
      <Card><LineChart title="People taking part" labels={labels} series={[{ name: "Giving kudos or posting", values: d.engagement.map((e) => e.posters) }, { name: "Using the app", values: d.engagement.map((e) => e.activePeople) }]} /></Card>
      <Card><BarChart title={d.logins.dau.length < (Date.parse(d.range.to) - Date.parse(d.range.from)) / 864e5 ? `Daily active people, last ${d.logins.dau.length} days of the period` : "Daily active people"} labels={d.logins.dau.map((x) => dLabel(x.day))} series={[{ name: "People", values: d.logins.dau.map((x) => x.count) }]}
        note={`Only people who said yes to login counts (${d.logins.optedIn} of ${d.staff}). Days with 1 to 4 people are hidden.`} /></Card>
    </div>
  </>;
}

function RangeBar({ range, set }: { range: Range; set: (r: Range) => void }) {
  const today = new Date(Date.now() + 19_800_000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(range.from || today), [to, setTo] = useState(range.to || today);
  const [custom, setCustom] = useState(range.preset === "custom");
  return <div className="dash-range" role="group" aria-label="Date range">
    {RANGE_PRESETS.map(([k, l]) => <button key={k} type="button" className={`btn ${(k === "custom" ? custom : !custom && range.preset === k) ? "on" : ""}`} aria-pressed={k === "custom" ? custom : !custom && range.preset === k}
      onClick={() => { if (k === "custom") setCustom(true); else { setCustom(false); set({ preset: k, from: "", to: "" }); } }}>{l}</button>)}
    {custom && <><label className="dash-date"><span>From</span><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
      <label className="dash-date"><span>To</span><input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} /></label>
      <button type="button" className="btn p" disabled={!from || !to} onClick={() => set({ preset: "custom", from, to })}>Apply</button></>}
  </div>;
}

export default function Dashboard() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
  const roles = new Set(me.data?.roles ?? []);
  const tabs: [string, string][] = [
    ...(roles.has("hr_admin") ? [["feel", "How people feel"], ["people", "People"]] as [string, string][] : []),
    ...(roles.has("hr_admin") || roles.has("finance_signatory") ? [["finance", "Finance"]] as [string, string][] : []),
  ];
  const [pick, setTab] = useState<string | null>(null);
  const [range, setRange] = useState<Range>(() => { try { const r = JSON.parse(localStorage.getItem("dash-range") ?? "null"); if (r?.preset) return r; } catch { /* ignore */ } return { preset: "12m", from: "", to: "" }; });
  const pickRange = (r: Range) => { setRange(r); try { localStorage.setItem("dash-range", JSON.stringify(r)); } catch { /* ignore */ } };
  const tab = pick ?? tabs[0]?.[0];
  if (me.data && !tabs.length) return <Page title="Dashboards"><Card><p>Dashboards are for HR admins and finance.</p></Card></Page>;
  return <Page title="Dashboards">
    <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
    <RangeBar range={range} set={pickRange} />
    {tab === "people" && <PeopleTab range={range} />}{tab === "finance" && <FinanceTab range={range} />}{tab === "feel" && <FeelTab range={range} />}
  </Page>;
}
