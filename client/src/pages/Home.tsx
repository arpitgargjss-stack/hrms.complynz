import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Card, Chip, ErrorNote, inr } from "../lib/ui";
import { Story, celebrate } from "../lib/gz";
import { KudosPreview, PulseCard } from "./Kudos";
import { POLL_MS, useNewItemChime } from "../lib/sound";
import "../gz.css";

type Me = { email: string; employeeId: string | null; roles: string[] };
type Ev = { id: string; name: string; kind: string; date: string; years?: number; photoFileId?: string | null };
type Ann = { id: string; title: string; body: string; kind: string; pinned: boolean; createdAt: string };
type HomeData = { today: string; birthdays: Ev[]; anniversaries: Ev[]; announcements: Ann[]; pending: { policiesToAck: number } };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dLabel = (md: string) => `${Number(md.slice(3, 5))} ${MON[Number(md.slice(0, 2)) - 1]}`;

/** One-time ask for the login-count consent. It also lives in My privacy, with the other choices. */
type Consent = { key: string; status: string };
function LoginConsentAsk() {
  const qc = useQueryClient();
  const c = useQuery({ queryKey: ["my-consents"], queryFn: () => api<Consent[]>("/me/consents") });
  const set = useMutation({ mutationFn: (granted: boolean) => api("/me/consents/login_activity", { method: "PUT", body: { granted, noticeVersion: "login-v1" } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["my-consents"] }) });
  if (c.data?.find((x) => x.key === "login_activity")?.status !== "not_set") return null;
  return <section className="gz-card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    <b style={{ fontSize: 16 }}>One quick privacy choice</b>
    <span style={{ fontSize: 14 }}>May we record the days you sign in? Only the date is kept, no times or devices. HR sees company-wide counts only, never you by name. You can change this any time in My privacy, and saying no deletes anything recorded.</span>
    <ErrorNote error={set.error} />
    <div style={{ display: "flex", gap: 8 }}><button className="gz-btn" disabled={set.isPending} onClick={() => set.mutate(true)}>Yes, that's fine</button><button className="gz-btn" disabled={set.isPending} onClick={() => set.mutate(false)}>No thanks</button></div>
  </section>;
}

// ---------------------------------------------------------------------
// Personal home: greeting, start my day, quick actions, moments, kudos, pulse
// ---------------------------------------------------------------------
type Today = {
  today: string; firstName: string; workStart: string; latestStart: string | null;
  day: { state: "not_started" | "working" | "done"; startedAt: string | null }; streak: number; week: { date: string; status: string }[];
  longWeekend: { holiday: string; take: string[]; from: string; to: string; daysOff: number } | null;
  latestPayslip: string | null; lastClaim: { amountPaise: number; status: string } | null;
  newJoiners: { id: string; fullName: string; photoFileId: string | null; department: string | null }[];
};
type Leave = { balances: { key: string; name: string; available?: number; entitledX2: number }[] };
const fmtDay = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const timeOf = (s: string) => new Date(s).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
function greeting() { const h = new Date().getHours(); return h < 5 ? "Up late" : h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening"; }

function coords(): Promise<{ lat?: number; lng?: number }> {
  return new Promise((ok) => {
    if (!navigator.geolocation) return ok({});
    navigator.geolocation.getCurrentPosition((p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude }), () => ok({}), { timeout: 8000, maximumAge: 60000 });
  });
}

function StartMyDay({ t }: { t: Today }) {
  const qc = useQueryClient();
  const punch = useMutation({
    mutationFn: async (kind: "in" | "out") => api<{ withinOffice: boolean | null; remote: boolean }>("/attendance/punch", { body: { kind, ...(await coords()) } }),
    onSuccess: (r, kind) => {
      qc.invalidateQueries({ queryKey: ["today"] }); qc.invalidateQueries({ queryKey: ["attendance"] });
      if (kind === "in") celebrate("Good to see you.", r.remote ? "Working remotely today" : r.withinOffice === false ? "Recorded as outside the office" : "Have a good day");
      else celebrate("Thanks for today.", "Switch off and rest well");
    },
  });
  const working = t.day.state === "working";
  const title = t.day.state === "not_started" ? "Hope you're doing well today." : working ? "Glad you're here." : "Thanks for today.";
  const sub = t.day.state === "not_started" ? `Start your day whenever you're ready${t.latestStart ? ` (by ${t.latestStart})` : ""}.` : working ? `Started at ${timeOf(t.day.startedAt!)}. Take your breaks, and shout if you need a hand.` : "Log off and switch off. Time away matters as much as time in.";
  return (
    <section className="gz-hero" style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 16, padding: 26 }}>
      <svg className="gz-float" width="220" height="220" viewBox="0 0 260 260" aria-hidden="true" style={{ right: -50, top: -60, opacity: 0.25 }}><circle cx="130" cy="130" r="120" fill="none" stroke="#fff" strokeWidth="2" /><circle cx="130" cy="130" r="80" fill="none" stroke="#fff" strokeWidth="2" /><circle cx="130" cy="130" r="40" fill="none" stroke="#fff" strokeWidth="2" /></svg>
      <span className="gz-pill gz-glass" style={{ alignSelf: "flex-start", color: "#fff" }}>{t.day.state === "not_started" ? greeting() : working ? <><span className="gz-live" />At work</> : "Done for today"}</span>
      <div><b className="display" style={{ fontSize: 30, display: "block", position: "relative" }}>{title}</b><span style={{ color: "#dbe6ff" }}>{sub}</span></div>
      <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap", position: "relative" }}>
        {t.day.state !== "done" && <button className="gz-btn white" style={{ minHeight: 52, fontSize: 16, padding: "0 26px" }} disabled={punch.isPending} onClick={() => punch.mutate(working ? "out" : "in")}>{working ? "End my day" : "Start my day"}</button>}
        <a href="#pulse" style={{ color: "#fff", fontSize: 14, fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 3 }}>How are you, really? Three anonymous taps</a>
      </div>
      <ErrorNote error={punch.error} />
    </section>
  );
}

function Quick({ href, title, sub, bg, fg, icon }: { href: string; title: string; sub: string; bg: string; fg: string; icon: string }) {
  return (
    <Link href={href} className="gz-card lift" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 16, padding: 16, textDecoration: "none", color: "inherit" }}>
      <span style={{ width: 40, height: 40, borderRadius: 12, background: bg, color: fg, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icon} /></svg></span>
      <span><b style={{ display: "block", fontSize: 15 }}>{title}</b><span style={{ fontSize: 13, color: "var(--gz-mute)" }}>{sub}</span></span>
    </Link>
  );
}

function Moment({ name, fileId, title, sub, cta, href, bg }: { name: string; fileId?: string | null; title: string; sub: string; cta: string; href: string; bg: string }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center", padding: 12, borderRadius: 18, background: bg }}>
      <Story name={name} fileId={fileId} size={48} />
      <span style={{ flex: 1, minWidth: 0 }}><b style={{ display: "block", fontSize: 14, color: "#0f172a" }}>{title}</b><span style={{ fontSize: 12, color: "#475569" }}>{sub}</span></span>
      <Link className="gz-btn sm" href={href}>{cta}</Link>
    </div>
  );
}

export default function Home() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
  const feed = useQuery({ queryKey: ["feed", "team"], refetchInterval: POLL_MS, queryFn: () => api<{ createdAt: string; author: { id: string } }[]>("/feed?tab=team") });
  useNewItemChime(feed.data, (p) => p.createdAt, (p) => p.author.id);
  const home = useQuery({ queryKey: ["home"], queryFn: () => api<HomeData & { birthdays: (Ev & { photoFileId?: string | null })[]; anniversaries: (Ev & { photoFileId?: string | null })[] }>("/home") });
  const hasEmp = !!me.data?.employeeId;
  const t = useQuery({ queryKey: ["today"], enabled: hasEmp, queryFn: () => api<Today>("/home/today") });
  const leave = useQuery({ queryKey: ["my-leave-home"], enabled: hasEmp, queryFn: () => api<Leave>("/me/leave") });
  const dashRole = !!me.data?.roles.some((r) => r === "hr_admin" || r === "finance_signatory");
  const h = home.data, d = t.data;
  const earned = leave.data?.balances.find((b) => b.key !== "unpaid" && b.key !== "sick") ?? leave.data?.balances[0];
  const avail = earned ? (earned.available ?? earned.entitledX2) / 2 : null;
  const todayMD = h?.today.slice(5);
  const bdays = (h?.birthdays ?? []).filter((b) => b.date === todayMD), annivs = (h?.anniversaries ?? []).filter((b) => b.date === todayMD);
  const soon = [...(h?.birthdays ?? []), ...(h?.anniversaries ?? [])].filter((b) => b.date !== todayMD).slice(0, 3);
  return (
    <div className="gz" style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <ErrorNote error={home.error ?? t.error} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
        <div><span style={{ fontSize: 14, color: "var(--gz-mute)" }}>{h ? fmtDay(h.today) : ""}</span>
          <h1 style={{ margin: "4px 0 0", fontSize: "clamp(30px,4vw,42px)", fontWeight: 800, lineHeight: 1.05 }}>{greeting()}{d ? `, ${d.firstName}` : ""}. <span style={{ color: "var(--gz-blue)" }}>{new Date().getDay() === 5 ? "Last stretch before the weekend." : "Let's make it a good one."}</span></h1></div>
        <div className="gz-chips">
          {h && h.pending.policiesToAck > 0 && <Link href="/policies" className="gz-pill" style={{ background: "#f0f5ff", color: "#1e3a8a", border: "1px solid #bfdbfe", textDecoration: "none" }}>{h.pending.policiesToAck} {h.pending.policiesToAck === 1 ? "policy" : "policies"} to read</Link>}
          {d?.lastClaim?.status === "paid" && <span className="gz-pill" style={{ background: "#ecfdf5", color: "#047857", border: "1px solid #a7f3d0" }}>Claim of {inr(d.lastClaim.amountPaise).replace(/\.00$/, "")} paid</span>}
        </div>
      </div>

      {hasEmp && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 20 }}>
        {d ? <StartMyDay t={d} /> : <div className="gz-card">Loading your day…</div>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 12 }}>
          <Quick href="/leave" title="Plan time off" sub={avail != null ? `${avail} ${earned?.name.toLowerCase() ?? "days"} left` : "Apply in a few taps"} bg="#f0f5ff" fg="#0048e4" icon="M3 5h18v16H3zM16 3v4M8 3v4M3 11h18M12 14v4M10 16h4" />
          <Quick href="/reimbursements" title="Snap a bill" sub="Claim in three steps" bg="#eff6ff" fg="#2563eb" icon="M3 8h3l2-3h8l2 3h3v12H3zM12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z" />
          <Quick href="/payslips" title="My payslips" sub={d?.latestPayslip ? `${new Date(d.latestPayslip + "-01").toLocaleDateString("en-IN", { month: "long" })} payslip ready` : "All your payslips"} bg="#eff6ff" fg="#0048e4" icon="M2 6h20v12H2zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z" />
          <Quick href="/kudos" title="Give kudos" sub="Thank someone, publicly" bg="#eff6ff" fg="#2563eb" icon="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7z" />
        </div>
      </div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 20, alignItems: "start" }}>
        <section className="gz-card gz-pop" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><b style={{ fontSize: 16 }}>Today's moments</b><Link href="/team" style={{ fontSize: 13, fontWeight: 700 }}>Know your team</Link></div>
          {bdays.map((b) => <Moment key={"b" + b.id} name={b.name} fileId={b.photoFileId} title={`${b.name.split(" ")[0]}'s birthday`} sub="Shown because they opted in" cta="Send wishes" href={`/kudos?to=${b.id}&value=Wishes`} bg="#f0f5ff" />)}
          {annivs.map((b) => <Moment key={"a" + b.id} name={b.name} fileId={b.photoFileId} title={`${b.name.split(" ")[0]}, ${b.years} year${b.years === 1 ? "" : "s"} here`} sub="Work anniversary" cta="Say congrats" href={`/kudos?to=${b.id}&value=Wishes`} bg="#eff6ff" />)}
          {d?.newJoiners.map((j) => <Moment key={"n" + j.id} name={j.fullName} fileId={j.photoFileId} title={`${j.fullName.split(" ")[0]} joined${j.department ? ` ${j.department}` : ""}`} sub="New here" cta="Say hi" href={`/vibe/${j.id}`} bg="#f0f5ff" />)}
          {!bdays.length && !annivs.length && !d?.newJoiners.length && <span className="k">No birthdays, anniversaries or new joiners today.</span>}
          {soon.length > 0 && <div style={{ fontSize: 13, color: "var(--gz-mute)" }}>Coming up: {soon.map((x) => `${x.name.split(" ")[0]} (${dLabel(x.date)})`).join(", ")}</div>}
        </section>
        <KudosPreview />
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {hasEmp && <PulseCard />}
          {d?.longWeekend && <section className="gz-card gz-pop" style={{ background: "#f0f5ff", borderColor: "#bfdbfe", color: "#172554" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#1e3a8a" }}>Leave planner tip · {d.longWeekend.holiday}</span>
            <b style={{ display: "block", fontSize: 16, margin: "6px 0" }}>Take {d.longWeekend.take.map(fmtDay).join(" and ")} off, get {d.longWeekend.daysOff} days in a row.</b>
            <Link href="/leave" style={{ fontSize: 13, fontWeight: 700, color: "#1e3a8a" }}>Plan it</Link></section>}
        </div>
      </div>

      {h && h.announcements.length > 0 && <section className="gz-card"><b style={{ fontSize: 16 }}>Announcements</b>
        {h.announcements.map((a) => <div key={a.id} style={{ padding: "10px 0", borderTop: "1px solid var(--gz-line)" }}><b>{a.title}</b> {a.pinned && <Chip tone="info">Pinned</Chip>}
          <div style={{ whiteSpace: "pre-wrap", fontSize: 14 }}>{a.body}</div><div className="k">{new Date(a.createdAt).toLocaleDateString("en-IN")}</div></div>)}</section>}

      {hasEmp && <LoginConsentAsk />}
      {dashRole && <section><Link href="/dashboards" className="gz-btn" style={{ textDecoration: "none" }}>Open dashboards</Link></section>}
      {home.isLoading && <p>Loading…</p>}
    </div>
  );
}
