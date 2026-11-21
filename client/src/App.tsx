import { lazy, Suspense, useEffect, useState } from "react";
import { Link, Redirect, Route, Switch, useLocation } from "wouter";
import { SignedIn, SignedOut, SignIn } from "@clerk/clerk-react";
import { useQuery } from "@tanstack/react-query";
import { api, useBindAuth } from "./lib/api";
import { playChime, useSound } from "./lib/sound";

const P = {
  Home: lazy(() => import("./pages/Home")), People: lazy(() => import("./pages/People")), OrgChart: lazy(() => import("./pages/OrgChart")),
  Org: lazy(() => import("./pages/Org")), Assets: lazy(() => import("./pages/Assets")), Policies: lazy(() => import("./pages/Policies")),
  Access: lazy(() => import("./pages/Access")), Hiring: lazy(() => import("./pages/Hiring")), Payroll: lazy(() => import("./pages/Payroll")),
  Payslips: lazy(() => import("./pages/Payslips")), Attendance: lazy(() => import("./pages/Attendance")), Leave: lazy(() => import("./pages/Leave")),
  Reimbursements: lazy(() => import("./pages/Reimbursements")), Exits: lazy(() => import("./pages/Exits")), Feedback: lazy(() => import("./pages/Feedback")),
  Profile: lazy(() => import("./pages/Profile")), Audit: lazy(() => import("./pages/Audit")),
  Accept: lazy(() => import("./pages/Accept")), Onboarding: lazy(() => import("./pages/Onboarding")),
  CompleteProfile: lazy(() => import("./pages/CompleteProfile")),
  Vibe: lazy(() => import("./pages/Vibe")), Team: lazy(() => import("./pages/Team")), Feed: lazy(() => import("./pages/Feed")), Privacy: lazy(() => import("./pages/Privacy")), Kudos: lazy(() => import("./pages/Kudos")),
};

type Me = { email: string; employeeId: string | null; roles: string[]; profile: { complete: boolean; missing: string[] } | null };
const SKIP_KEY = "hrms.profilePromptSkipped";
type NavItem = { to: string; label: string; roles?: string[] };
const NAV: { title: string; items: NavItem[] }[] = [
  { title: "", items: [{ to: "/home", label: "Home" }] },
  { title: "Me", items: [
    { to: "/profile", label: "My profile" },
    { to: "/vibe", label: "My vibe page" },
    { to: "/privacy", label: "My privacy" },
    { to: "/attendance", label: "Attendance" },
    { to: "/leave", label: "Leave" },
    { to: "/reimbursements", label: "Reimbursements" },
    { to: "/payslips", label: "My payslips" },
    { to: "/policies", label: "Policies" },
    { to: "/feedback", label: "Feedback" },
    { to: "/exits", label: "Resignation and PIPs" },
  ] },
  { title: "Team", items: [
    { to: "/team", label: "Know your team" },
    { to: "/kudos", label: "Kudos wall" },
    { to: "/feed", label: "Team feed" },
    { to: "/org-chart", label: "Org chart" },
  ] },
  { title: "Admin", items: [
    { to: "/people", label: "People", roles: ["hr_admin", "manager"] },
    { to: "/hiring", label: "Hiring", roles: ["hr_admin"] },
    { to: "/payroll", label: "Payroll", roles: ["hr_admin", "finance_signatory"] },
    { to: "/org", label: "Organisation", roles: ["hr_admin"] },
    { to: "/assets", label: "Assets", roles: ["hr_admin"] },
    { to: "/access", label: "Roles and access", roles: ["hr_admin"] },
    { to: "/audit", label: "Audit log", roles: ["hr_admin"] },
  ] },
];
const NAV_KEY = "hrms.navClosed";
function SideNav({ roles, loc }: { roles: Set<string>; loc: string }) {
  const [closed, setClosed] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(NAV_KEY) || "[]"); } catch { return []; } });
  const toggle = (t: string) => { const n = closed.includes(t) ? closed.filter((x) => x !== t) : [...closed, t]; setClosed(n); try { localStorage.setItem(NAV_KEY, JSON.stringify(n)); } catch { /* private mode */ } };
  const isOn = (to: string) => loc === to || loc.startsWith(to + "/");
  return <nav aria-label="Sections">{NAV.map((g) => {
    const items = g.items.filter((n) => !n.roles || n.roles.some((r) => roles.has(r)));
    if (!items.length) return null;
    const links = items.map((n) => <Link key={n.to} href={n.to} className={isOn(n.to) ? "on" : ""} aria-current={isOn(n.to) ? "page" : undefined}>{n.label}</Link>);
    if (!g.title) return <div key="top">{links}</div>;
    // A group holding the current page always stays open.
    const shut = closed.includes(g.title) && !items.some((n) => isOn(n.to));
    return <div key={g.title} className={`nav-group${shut ? " closed" : ""}`}>
      <button type="button" aria-expanded={!shut} onClick={() => toggle(g.title)}>{g.title}<i aria-hidden="true">▾</i></button><div>{links}</div></div>;
  })}</nav>;
}

type Theme = "light" | "dark" | "system";
const THEME_KEY = "hrms.theme";
function useTheme(): [Theme, (t: Theme) => void] {
  const [t, setT] = useState<Theme>(() => { try { return (localStorage.getItem(THEME_KEY) as Theme) || "system"; } catch { return "system"; } });
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => { document.documentElement.dataset.theme = t === "system" ? (mq.matches ? "dark" : "light") : t; };
    apply(); mq.addEventListener("change", apply); return () => mq.removeEventListener("change", apply);
  }, [t]);
  return [t, (n) => { setT(n); try { localStorage.setItem(THEME_KEY, n); } catch { /* private mode */ } }];
}
function ThemePick() {
  const [t, set] = useTheme();
  return <div className="theme-pick" role="radiogroup" aria-label="Theme">{(["light", "system", "dark"] as Theme[]).map((x) =>
    <button key={x} role="radio" aria-checked={t === x} className={t === x ? "on" : ""} onClick={() => set(x)}>{x === "system" ? "Auto" : x[0].toUpperCase() + x.slice(1)}</button>)}</div>;
}

function SoundPick() {
  const [on, set] = useSound();
  return <label className="sound-pick"><span>Sound</span>
    <input type="checkbox" role="switch" className="pf-switch" checked={on} aria-label="Notification sound" onChange={(e) => { set(e.target.checked); if (e.target.checked) setTimeout(playChime, 30); }} /></label>;
}

function Shell() {
  useBindAuth();
  const [loc] = useLocation();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
  // "Skip for now" lasts for this browser session; the prompt comes back on the next login until the profile is complete.
  const [skipped, setSkipped] = useState(() => { try { return sessionStorage.getItem(SKIP_KEY) === "1"; } catch { return false; } });
  if (me.isLoading) return <p style={{ padding: 24 }}>Loading…</p>;
  if (me.error) return <p style={{ padding: 24 }} role="alert">{(me.error as Error).message}</p>;
  const roles = new Set(me.data!.roles);
  if (me.data!.employeeId && me.data!.profile && !me.data!.profile.complete && !skipped) {
    const skip = () => { try { sessionStorage.setItem(SKIP_KEY, "1"); } catch { /* private mode */ } setSkipped(true); };
    return <Suspense fallback={<p style={{ padding: 24 }}>Loading…</p>}><P.CompleteProfile id={me.data!.employeeId} onSkip={skip} /></Suspense>;
  }
  return (
    <div className="shell">
      <aside className="side"><div className="brand"><img src="/logo.png" alt="Complynz" width={160} height={37} /></div><div className="sub">HR · hrms.complynz.com</div><ThemePick /><SoundPick />
        <SideNav roles={roles} loc={loc} />
      </aside>
      <main className="main"><Suspense fallback={<p>Loading…</p>}>
        <Switch>
          <Route path="/"><Redirect to="/home" replace /></Route><Route path="/home" component={P.Home} /><Route path="/people/:id?" component={P.People} /><Route path="/org-chart" component={P.OrgChart} />
          <Route path="/hiring" component={P.Hiring} /><Route path="/org" component={P.Org} /><Route path="/assets" component={P.Assets} />
          <Route path="/attendance" component={P.Attendance} /><Route path="/leave" component={P.Leave} />
          <Route path="/reimbursements" component={P.Reimbursements} /><Route path="/exits" component={P.Exits} />
          <Route path="/payroll" component={P.Payroll} /><Route path="/payslips" component={P.Payslips} /><Route path="/feedback" component={P.Feedback} />
          <Route path="/policies/:slug?" component={P.Policies} /><Route path="/profile" component={P.Profile} />
          <Route path="/access" component={P.Access} />
          <Route path="/vibe/:id?" component={P.Vibe} /><Route path="/team" component={P.Team} /><Route path="/feed" component={P.Feed} /><Route path="/privacy" component={P.Privacy} /><Route path="/kudos" component={P.Kudos} /><Route path="/audit" component={P.Audit} />
          <Route>Page not found</Route>
        </Switch></Suspense></main>
    </div>
  );
}

export default function App({ devNoClerk }: { devNoClerk?: boolean }) {
  const [loc] = useLocation();
  // Public candidate routes sit outside the staff login.
  if (loc.startsWith("/accept/") || loc.startsWith("/onboarding/")) {
    return <Suspense fallback={<p>Loading…</p>}><Switch><Route path="/accept/:token" component={P.Accept} /><Route path="/onboarding/:token" component={P.Onboarding} /></Switch></Suspense>;
  }
  if (devNoClerk) return <Shell />;
  return (<><SignedOut><div style={{ display: "grid", placeItems: "center", alignContent: "center", gap: 24, minHeight: "100vh", padding: 16 }}><img src="/logo-full.png" alt="Complynz: Privacy First. Zero-Trust Compliance" style={{ width: 320, maxWidth: "100%", height: "auto" }} /><SignIn routing="hash" /></div></SignedOut><SignedIn><Shell /></SignedIn></>);
}
