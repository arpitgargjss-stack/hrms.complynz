import { lazy, Suspense, useState } from "react";
import { Link, Redirect, Route, Switch, useLocation } from "wouter";
import { SignedIn, SignedOut, SignIn } from "@clerk/clerk-react";
import { useQuery } from "@tanstack/react-query";
import { api, useBindAuth } from "./lib/api";

const P = {
  Home: lazy(() => import("./pages/Home")), People: lazy(() => import("./pages/People")), OrgChart: lazy(() => import("./pages/OrgChart")),
  Org: lazy(() => import("./pages/Org")), Assets: lazy(() => import("./pages/Assets")), Policies: lazy(() => import("./pages/Policies")),
  Access: lazy(() => import("./pages/Access")), Hiring: lazy(() => import("./pages/Hiring")), Payroll: lazy(() => import("./pages/Payroll")),
  Payslips: lazy(() => import("./pages/Payslips")), Attendance: lazy(() => import("./pages/Attendance")), Leave: lazy(() => import("./pages/Leave")),
  Reimbursements: lazy(() => import("./pages/Reimbursements")), Exits: lazy(() => import("./pages/Exits")), Feedback: lazy(() => import("./pages/Feedback")),
  Profile: lazy(() => import("./pages/Profile")), Audit: lazy(() => import("./pages/Audit")),
  Accept: lazy(() => import("./pages/Accept")), Onboarding: lazy(() => import("./pages/Onboarding")),
  CompleteProfile: lazy(() => import("./pages/CompleteProfile")),
};

type Me = { email: string; employeeId: string | null; roles: string[]; profile: { complete: boolean; missing: string[] } | null };
const SKIP_KEY = "hrms.profilePromptSkipped";
const NAV: { to: string; label: string; roles?: string[] }[] = [
  { to: "/profile", label: "My profile" },
  { to: "/home", label: "Home" },
  { to: "/people", label: "People", roles: ["hr_admin", "manager"] },
  { to: "/org-chart", label: "Org chart" },
  { to: "/hiring", label: "Hiring", roles: ["hr_admin"] },
  { to: "/org", label: "Organisation", roles: ["hr_admin"] },
  { to: "/assets", label: "Assets", roles: ["hr_admin"] },
  { to: "/attendance", label: "Attendance" },
  { to: "/leave", label: "Leave" },
  { to: "/reimbursements", label: "Reimbursements" },
  { to: "/exits", label: "Resignation and PIPs" },
  { to: "/payroll", label: "Payroll", roles: ["hr_admin", "finance_signatory"] },
  { to: "/payslips", label: "My payslips" },
  { to: "/feedback", label: "Feedback" },
  { to: "/policies", label: "Policies" },
  { to: "/access", label: "Roles and access", roles: ["hr_admin"] },
  { to: "/audit", label: "Audit log", roles: ["hr_admin"] },
];

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
        <nav aria-label="Sections">{NAV.filter((n) => !n.roles || n.roles.some((r) => roles.has(r))).map((n) =>
          <Link key={n.to} href={n.to} className={loc === n.to || loc.startsWith(n.to + "/") ? "on" : ""}>{n.label}</Link>)}</nav>
      </aside>
      <main className="main"><Suspense fallback={<p>Loading…</p>}>
        <Switch>
          <Route path="/"><Redirect to="/profile" replace /></Route><Route path="/home" component={P.Home} /><Route path="/people/:id?" component={P.People} /><Route path="/org-chart" component={P.OrgChart} />
          <Route path="/hiring" component={P.Hiring} /><Route path="/org" component={P.Org} /><Route path="/assets" component={P.Assets} />
          <Route path="/attendance" component={P.Attendance} /><Route path="/leave" component={P.Leave} />
          <Route path="/reimbursements" component={P.Reimbursements} /><Route path="/exits" component={P.Exits} />
          <Route path="/payroll" component={P.Payroll} /><Route path="/payslips" component={P.Payslips} /><Route path="/feedback" component={P.Feedback} />
          <Route path="/policies/:slug?" component={P.Policies} /><Route path="/profile" component={P.Profile} />
          <Route path="/access" component={P.Access} /><Route path="/audit" component={P.Audit} />
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
