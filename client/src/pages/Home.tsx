import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Card, Chip, ErrorNote, Page, inr } from "../lib/ui";

type Me = { email: string; employeeId: string | null; roles: string[] };
type Ev = { id: string; name: string; kind: string; date: string; years?: number };
type Ann = { id: string; title: string; body: string; kind: string; pinned: boolean; createdAt: string };
type HomeData = { today: string; birthdays: Ev[]; anniversaries: Ev[]; announcements: Ann[]; pending: { policiesToAck: number } };
type Trends = {
  asOf: string; netSalary: { month: string; netPaise: number; payslips: number }[]; headcount: { month: string; headcount: number }[];
  joiners: { month: string; count: number }[]; offboarding: { month: string; count: number }[];
  org: { total: number; active: number; onNotice: number; exited: number; onLeaveToday: number; pendingLeaveRequests: number; openResignations: number; openPips: number };
};
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const mLabel = (m: string) => MON[Number(m.slice(5, 7)) - 1] + " " + m.slice(2, 4);
const dLabel = (md: string) => `${Number(md.slice(3, 5))} ${MON[Number(md.slice(0, 2)) - 1]}`;

type Series = { name: string; color: string; values: number[] };
/** Grouped bar chart in plain SVG. Values are also available as a data table for screen readers. */
function Bars({ title, labels, series, fmt = String }: { title: string; labels: string[]; series: Series[]; fmt?: (n: number) => string }) {
  const W = 360, H = 170, pad = { l: 8, r: 8, t: 18, b: 24 };
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const gw = (W - pad.l - pad.r) / labels.length, bw = Math.min(26, (gw - 10) / series.length);
  const desc = labels.map((l, i) => `${l}: ${series.map((s) => `${s.name} ${fmt(s.values[i])}`).join(", ")}`).join("; ");
  return (
    <figure style={{ margin: 0 }}>
      <figcaption style={{ fontWeight: 500, marginBottom: 4 }}>{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. ${desc}`} style={{ width: "100%", height: "auto", maxWidth: 480 }}>
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="#d9dde8" />
        {labels.map((l, i) => {
          const x0 = pad.l + i * gw + (gw - bw * series.length) / 2;
          return (
            <g key={l}>
              {series.map((s, j) => {
                const h = ((H - pad.t - pad.b) * s.values[i]) / max;
                return (<g key={s.name}><rect x={x0 + j * bw} y={H - pad.b - h} width={bw - 2} height={h} fill={s.color} rx={2} />
                  <text x={x0 + j * bw + (bw - 2) / 2} y={H - pad.b - h - 4} textAnchor="middle" fontSize="10" fill="#3a4260">{fmt(s.values[i])}</text></g>);
              })}
              <text x={pad.l + i * gw + gw / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="#5b6478">{l}</text>
            </g>);
        })}
      </svg>
      {series.length > 1 && <div className="k" style={{ display: "flex", gap: 12 }}>{series.map((s) => <span key={s.name}><span aria-hidden style={{ display: "inline-block", width: 10, height: 10, background: s.color, borderRadius: 2, marginRight: 4 }} />{s.name}</span>)}</div>}
    </figure>
  );
}

function Dashboard() {
  const t = useQuery({ queryKey: ["trends"], queryFn: () => api<Trends>("/dashboard/trends") });
  if (t.error) return <ErrorNote error={t.error} />;
  if (!t.data) return <Card><p>Loading dashboard…</p></Card>;
  const d = t.data;
  const stats: [string, number][] = [["Active employees", d.org.active], ["On notice", d.org.onNotice], ["On leave today", d.org.onLeaveToday], ["Leave requests pending", d.org.pendingLeaveRequests], ["Open resignations", d.org.openResignations], ["Open PIPs", d.org.openPips]];
  const net3 = d.netSalary, hc6 = d.headcount.map((h) => h.month);
  return (
    <>
      <div className="grid" style={{ marginBottom: 16 }}>
        {stats.map(([k, v]) => <div className="card" key={k} style={{ marginBottom: 0 }}><div className="k">{k}</div><div style={{ fontSize: 28, fontWeight: 600 }}>{v}</div></div>)}
      </div>
      <div className="grid">
        <Card><Bars title="Net salary, last 3 months" labels={net3.map((n) => mLabel(n.month))} series={[{ name: "Net pay", color: "#2f4bd6", values: net3.map((n) => n.netPaise) }]} fmt={(n) => (n ? inr(n).replace(/\.00$/, "") : "none")} />
          <p className="k">Locked and paid runs only.</p></Card>
        <Card><Bars title="Headcount and new joiners" labels={hc6.map(mLabel)} series={[{ name: "Headcount", color: "#2f4bd6", values: d.headcount.map((h) => h.headcount) }, { name: "New joiners", color: "#11a36a", values: d.joiners.map((j) => j.count) }]} /></Card>
        <Card><Bars title="Offboarding" labels={d.offboarding.map((o) => mLabel(o.month))} series={[{ name: "Exits", color: "#c2410c", values: d.offboarding.map((o) => o.count) }]} /></Card>
      </div>
    </>
  );
}

export default function Home() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
  const home = useQuery({ queryKey: ["home"], queryFn: () => api<HomeData>("/home") });
  const admin = !!me.data?.roles.includes("hr_admin");
  const h = home.data;
  return (
    <Page title={admin ? "HR dashboard" : "Home"} actions={<Link href="/org-chart" className="btn" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>Org chart</Link>}>
      <ErrorNote error={home.error} />
      {admin && <Dashboard />}
      {h && (
        <>
          {h.pending.policiesToAck > 0 && (
            <div className="note warn" role="status">You have {h.pending.policiesToAck} {h.pending.policiesToAck === 1 ? "policy" : "policies"} waiting for your acknowledgement. <Link href="/policies">Read policies</Link></div>
          )}
          <div className="grid">
            <Card><h2>Announcements</h2>
              {h.announcements.length === 0 && <p className="k">Nothing new.</p>}
              {h.announcements.map((a) => (
                <div key={a.id} style={{ padding: "10px 0", borderTop: "1px solid #eceef4" }}>
                  <div><strong>{a.title}</strong> {a.pinned && <Chip tone="info">Pinned</Chip>}</div>
                  <div style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{a.body}</div>
                  <div className="k">{new Date(a.createdAt).toLocaleDateString("en-IN")}</div>
                </div>))}
            </Card>
            <Card><h2>Birthdays</h2>
              {h.birthdays.length === 0 && <p className="k">No birthdays in the next 30 days. Only people who chose to show theirs appear here.</p>}
              {h.birthdays.map((b) => <div key={b.id + b.date} className="row-gap" style={{ justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid #eceef4" }}><span>{b.name}</span><span className="k">{dLabel(b.date)}</span></div>)}
            </Card>
            <Card><h2>Work anniversaries</h2>
              {h.anniversaries.length === 0 && <p className="k">No anniversaries in the next 30 days.</p>}
              {h.anniversaries.map((b) => <div key={b.id + b.date} className="row-gap" style={{ justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid #eceef4" }}><span>{b.name} <span className="k">{b.years} {b.years === 1 ? "year" : "years"}</span></span><span className="k">{dLabel(b.date)}</span></div>)}
            </Card>
          </div>
        </>
      )}
      {home.isLoading && <p>Loading…</p>}
    </Page>
  );
}
