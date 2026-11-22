import { lazy, Suspense, useEffect, useState } from "react";
import { Link, Redirect, Route, Switch, useLocation } from "wouter";
import { SignedIn, SignedOut, SignIn, useClerk } from "@clerk/clerk-react";
import { useQuery } from "@tanstack/react-query";
import { api, useBindAuth } from "./lib/api";
import { playChime, useSound } from "./lib/sound";
import { Avatar } from "./lib/Avatar";

const P = {
  Home: lazy(() => import("./pages/Home")), People: lazy(() => import("./pages/People")), OrgChart: lazy(() => import("./pages/OrgChart")),
  Org: lazy(() => import("./pages/Org")), Assets: lazy(() => import("./pages/Assets")), Policies: lazy(() => import("./pages/Policies")),
  Access: lazy(() => import("./pages/Access")), Hiring: lazy(() => import("./pages/Hiring")), Payroll: lazy(() => import("./pages/Payroll")), Dashboard: lazy(() => import("./pages/Dashboard")), Letters: lazy(() => import("./pages/Letters")), FullFinal: lazy(() => import("./pages/FullFinal")), Compliance: lazy(() => import("./pages/Compliance")), Config: lazy(() => import("./pages/Config")),
  Payslips: lazy(() => import("./pages/Payslips")), Attendance: lazy(() => import("./pages/Attendance")), Leave: lazy(() => import("./pages/Leave")),
  Reimbursements: lazy(() => import("./pages/Reimbursements")), Exits: lazy(() => import("./pages/Exits")), Feedback: lazy(() => import("./pages/Feedback")),
  Profile: lazy(() => import("./pages/Profile")), Audit: lazy(() => import("./pages/Audit")),
  Accept: lazy(() => import("./pages/Accept")), Onboarding: lazy(() => import("./pages/Onboarding")),
  CompleteProfile: lazy(() => import("./pages/CompleteProfile")),
  Vibe: lazy(() => import("./pages/Vibe")), Team: lazy(() => import("./pages/Team")), Feed: lazy(() => import("./pages/Feed")), Privacy: lazy(() => import("./pages/Privacy")), Kudos: lazy(() => import("./pages/Kudos")),
};

type Me = { email: string; employeeId: string | null; roles: string[]; profile: { fullName: string; photoFileId: string | null; complete: boolean; missing: string[] } | null };
const SKIP_KEY = "hrms.profilePromptSkipped";
type NavItem = { to: string; label: string; roles?: string[]; cat?: string };
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
    // Admin links sit in small categories so the list stays easy to scan.
    { to: "/dashboards", label: "Dashboards", roles: ["hr_admin", "finance_signatory"] },
    { to: "/people", label: "People", roles: ["hr_admin", "manager"], cat: "People" },
    { to: "/hiring", label: "Hiring and onboarding", roles: ["hr_admin"], cat: "People" },
    { to: "/org", label: "Organisation", roles: ["hr_admin"], cat: "People" },
    { to: "/payroll", label: "Payroll", roles: ["hr_admin", "finance_signatory"], cat: "Pay and money" },
    { to: "/full-and-final", label: "Full and final", roles: ["hr_admin"], cat: "Pay and money" },
    { to: "/compliance", label: "Compliance", roles: ["hr_admin", "finance_signatory"], cat: "Compliance and docs" },
    { to: "/letters", label: "Letters", roles: ["hr_admin"], cat: "Compliance and docs" },
    { to: "/admin/config", label: "Configuration", roles: ["hr_admin", "finance_signatory"], cat: "Settings" },
    { to: "/assets", label: "Assets", roles: ["hr_admin"], cat: "Settings" },
    { to: "/access", label: "Roles and access", roles: ["hr_admin"], cat: "Settings" },
    { to: "/audit", label: "Audit log", roles: ["hr_admin"], cat: "Settings" },
  ] },
];
const NAV_KEY = "hrms.navClosed";
function SideNav({ roles, loc }: { roles: Set<string>; loc: string }) {
  const [closed, setClosed] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem(NAV_KEY) || "[]"); } catch { return []; } });
  const save = (n: string[]) => { setClosed(n); try { localStorage.setItem(NAV_KEY, JSON.stringify(n)); } catch { /* private mode */ } };
  const toggle = (t: string) => save(closed.includes(t) ? closed.filter((x) => x !== t) : [...closed, t]);
  const isOn = (to: string) => loc === to || loc.startsWith(to + "/");
  // Opening a page expands the section (and category) holding it; after that a click on the header always wins.
  useEffect(() => {
    const keys = NAV.flatMap((g) => g.items.filter((n) => isOn(n.to)).flatMap((n) => [g.title, ...(n.cat ? [`${g.title}/${n.cat}`] : [])]));
    if (keys.some((k) => closed.includes(k))) save(closed.filter((k) => !keys.includes(k)));
  }, [loc]); // eslint-disable-line react-hooks/exhaustive-deps
  const link = (n: NavItem) => <Link key={n.to} href={n.to} className={isOn(n.to) ? "on" : ""} aria-current={isOn(n.to) ? "page" : undefined}>{n.label}</Link>;
  return <nav aria-label="Sections">{NAV.map((g) => {
    const items = g.items.filter((n) => !n.roles || n.roles.some((r) => roles.has(r)));
    if (!items.length) return null;
    if (!g.title) return <div key="top">{items.map(link)}</div>;
    const cats = [...new Set(items.map((n) => n.cat ?? ""))];
    const body = cats.map((c) => {
      const inCat = items.filter((n) => (n.cat ?? "") === c);
      if (!c) return inCat.map(link);
      const k = `${g.title}/${c}`, off = closed.includes(k);
      return <div key={k} className={`nav-sub${off ? " closed" : ""}`}>
        <button type="button" aria-expanded={!off} onClick={() => toggle(k)}>{c}<i aria-hidden="true">▾</i></button><div>{inCat.map(link)}</div></div>;
    });
    const shut = closed.includes(g.title);
    return <div key={g.title} className={`nav-group${shut ? " closed" : ""}`}>
      <button type="button" aria-expanded={!shut} onClick={() => toggle(g.title)}>{g.title}<i aria-hidden="true">▾</i></button><div>{body}</div></div>;
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

const HAS_CLERK = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const DEV_OUT_KEY = "hrms.devSignedOut";
function roleLabel(roles: Set<string>) {
  return roles.has("super_admin") ? "Super admin" : roles.has("hr_admin") ? "HR admin" : roles.has("finance_signatory") ? "Finance" : roles.has("manager") ? "Manager" : "Team member";
}
function clearSessionFlags() { try { sessionStorage.removeItem(SKIP_KEY); } catch { /* private mode */ } }
function useSignOut(): () => Promise<void> {
  // HAS_CLERK is a build-time constant, so the hook order never changes between renders.
  const clerk = HAS_CLERK ? useClerk() : null; // eslint-disable-line react-hooks/rules-of-hooks
  return async () => {
    clearSessionFlags();
    if (clerk) { await clerk.signOut({ redirectUrl: "/" }); return; }
    try { sessionStorage.setItem(DEV_OUT_KEY, "1"); } catch { /* private mode */ }
    window.location.assign("/");
  };
}

/** Profile block pinned to the bottom of the sidebar; opens a menu with profile links, theme, sound and sign out. */
function UserMenu({ me, roles }: { me: Me; roles: Set<string> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const signOut = useSignOut();
  const name = me.profile?.fullName || me.email;
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !(e.target as HTMLElement).closest(".user-menu")) setOpen(false);
    };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  return (
    <div className="user-menu">
      {open && <div className="um-pop" role="menu" aria-label="Account">
        <div className="um-head"><b>{name}</b><span>{me.email}</span></div>
        {me.employeeId && <Link role="menuitem" href="/profile" onClick={() => setOpen(false)}>My profile</Link>}
        {me.employeeId && <Link role="menuitem" href="/privacy" onClick={() => setOpen(false)}>My privacy</Link>}
        <div className="um-row"><ThemePick /></div>
        <div className="um-row"><SoundPick /></div>
        <button role="menuitem" type="button" className="um-out" disabled={busy} onClick={async () => { setBusy(true); try { await signOut(); } finally { setBusy(false); } }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
          {busy ? "Signing out…" : "Sign out"}</button>
      </div>}
      <button type="button" className="um-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
        <Avatar name={name} fileId={me.profile?.photoFileId} size={36} />
        <span className="um-who"><b>{name}</b><span className="um-role">{roleLabel(roles)}</span></span>
        <i aria-hidden="true">⌃</i>
      </button>
    </div>
  );
}

function DevSignedOut() {
  return <div style={{ display: "grid", placeItems: "center", alignContent: "center", gap: 20, minHeight: "100vh", padding: 16, textAlign: "center" }}>
    <img src="/logo-full.png" alt="Complynz: Privacy First. Zero-Trust Compliance" style={{ width: 320, maxWidth: "100%", height: "auto" }} />
    <div><b style={{ fontSize: 20 }}>You're signed out.</b><p className="k" style={{ margin: "6px 0 0" }}>Local preview: there is no real sign-in here, so signing in again uses the developer account.</p></div>
    <button className="btn p" onClick={() => { try { sessionStorage.removeItem(DEV_OUT_KEY); } catch { /* private mode */ } window.location.assign("/home"); }}>Sign in again</button>
  </div>;
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
      <aside className="side"><div className="brand"><img src="/logo.png" alt="Complynz" width={160} height={37} /></div><div className="sub">HR · hrms.complynz.com</div>
        <SideNav roles={roles} loc={loc} />
        <UserMenu me={me.data!} roles={roles} />
      </aside>
      <main className="main"><Suspense fallback={<p>Loading…</p>}>
        <Switch>
          <Route path="/"><Redirect to="/home" replace /></Route><Route path="/home" component={P.Home} /><Route path="/people/:id?" component={P.People} /><Route path="/org-chart" component={P.OrgChart} />
          <Route path="/hiring" component={P.Hiring} /><Route path="/org" component={P.Org} /><Route path="/assets" component={P.Assets} />
          <Route path="/attendance" component={P.Attendance} /><Route path="/leave" component={P.Leave} />
          <Route path="/reimbursements" component={P.Reimbursements} /><Route path="/exits" component={P.Exits} />
          <Route path="/payroll" component={P.Payroll} /><Route path="/dashboards" component={P.Dashboard} /><Route path="/letters" component={P.Letters} /><Route path="/full-and-final" component={P.FullFinal} /><Route path="/compliance" component={P.Compliance} /><Route path="/admin/config" component={P.Config} /><Route path="/payslips" component={P.Payslips} /><Route path="/feedback" component={P.Feedback} />
          <Route path="/policies/:slug?" component={P.Policies} /><Route path="/profile" component={P.Profile} />
          <Route path="/access" component={P.Access} />
          <Route path="/vibe/:id?" component={P.Vibe} /><Route path="/team" component={P.Team} /><Route path="/feed" component={P.Feed} /><Route path="/privacy" component={P.Privacy} /><Route path="/kudos" component={P.Kudos} /><Route path="/audit" component={P.Audit} />
          <Route>Page not found</Route>
        </Switch></Suspense></main>
    </div>
  );
}

/** Applies the saved theme as soon as the app loads (the picker itself only mounts inside the account menu). */
function useSavedTheme() {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => { let t: Theme = "system"; try { t = (localStorage.getItem(THEME_KEY) as Theme) || "system"; } catch { /* private mode */ } document.documentElement.dataset.theme = t === "system" ? (mq.matches ? "dark" : "light") : t; };
    apply(); mq.addEventListener("change", apply); return () => mq.removeEventListener("change", apply);
  }, []);
}

export default function App({ devNoClerk }: { devNoClerk?: boolean }) {
  useSavedTheme();
  const [loc] = useLocation();
  // Public candidate routes sit outside the staff login.
  if (loc.startsWith("/accept/") || loc.startsWith("/onboarding/")) {
    return <Suspense fallback={<p>Loading…</p>}><Switch><Route path="/accept/:token" component={P.Accept} /><Route path="/onboarding/:token" component={P.Onboarding} /></Switch></Suspense>;
  }
  if (devNoClerk) { let out = false; try { out = sessionStorage.getItem(DEV_OUT_KEY) === "1"; } catch { /* private mode */ } return out ? <DevSignedOut /> : <Shell />; }
  return (<><SignedOut><div style={{ display: "grid", placeItems: "center", alignContent: "center", gap: 24, minHeight: "100vh", padding: 16 }}><img src="/logo-full.png" alt="Complynz: Privacy First. Zero-Trust Compliance" style={{ width: 320, maxWidth: "100%", height: "auto" }} /><SignIn routing="hash" /></div></SignedOut><SignedIn><Shell /></SignedIn></>);
}
