import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Card, Chip, ErrorNote, Field, Page } from "../lib/ui";

type UR = { id: string; email: string; role: string; createdAt: string };
const ROLE_LABEL: Record<string, string> = { super_admin: "Super admin", hr_admin: "HR admin", finance_signatory: "Finance signatory" };

// Display matrix: HR admin | Finance signatory | Manager | Team member
const MATRIX: [string, [string, string, string, string, string][]][] = [
  ["People", [
    ["Own profile and documents", "Yes", "Yes", "Yes", "Yes"], ["Work details of others", "All", "No", "Direct reports", "Directory card only"],
    ["Org chart", "Yes", "Yes", "Yes", "Yes"], ["ID documents (PAN, Aadhaar)", "All, logged", "Own", "Own", "Own"]]],
  ["Pay", [
    ["Compensation and salary history", "All, logged", "All, logged", "Own", "Own"], ["Run payroll and lock", "Yes", "No", "No", "No"],
    ["Generate bank advice", "Yes", "Yes", "No", "No"], ["Sign documents with stamp and signature", "No", "Own signature only", "No", "No"]]],
  ["Time and leave", [
    ["See others' attendance and leave", "All", "No", "Direct reports", "No"], ["Approve leave and corrections", "All", "No", "Direct reports", "No"],
    ["Configure leave types, holidays, office location", "Yes", "No", "No", "No"]]],
  ["Claims, exits and performance", [
    ["Verify claims against policy", "No", "Yes", "No", "No"], ["Approve claims", "No", "No", "Direct reports", "No"],
    ["Accept resignations, set last working day", "Yes", "No", "No", "No"], ["Issue and manage performance improvement plans", "Yes", "No", "Input on direct reports", "No"]]],
  ["Hiring, policies and setup", [
    ["Add candidates, create onboarding links, generate letters", "Yes", "No", "No", "No"], ["Upload and publish policies", "Yes", "No", "No", "No"],
    ["Read and acknowledge policies", "Yes", "Yes", "Yes", "Yes"], ["Departments, locations, assets, salary rules", "Yes", "No", "No", "No"], ["Audit log", "Yes", "No", "No", "No"]]],
];
const tone = (v: string) => (v === "No" ? "mute" : v === "Yes" || v.startsWith("All") ? "ok" : "info");

export default function Access() {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("hr_admin");
  const roles = useQuery({ queryKey: ["user-roles"], queryFn: () => api<UR[]>("/user-roles") });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ roles: string[] }>("/me") });
  const iAmSuper = !!me.data?.roles.includes("super_admin");
  const add = useMutation({ mutationFn: () => api("/user-roles", { method: "POST", body: { email, role } }), onSuccess: () => { setEmail(""); qc.invalidateQueries({ queryKey: ["user-roles"] }); } });
  const del = useMutation({ mutationFn: (id: string) => api(`/user-roles/${id}`, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["user-roles"] }) });
  return (
    <Page title="Roles and access">
      <p className="k">Everyone with a company login is a team member. A manager role follows the reporting line automatically. HR admin and finance signatory are assigned by hand, to as few people as possible. A super admin holds both, and only a super admin can grant or remove super admin.</p>
      <Card>
        <h2>Assigned roles</h2>
        <ErrorNote error={roles.error} /><ErrorNote error={del.error} />
        <div style={{ overflowX: "auto" }}>
          <table className="t"><thead><tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col"><span style={{ position: "absolute", left: -9999 }}>Actions</span></th></tr></thead>
            <tbody>{roles.data?.map((u) => (
              <tr key={u.id}><td>{u.email}</td><td><Chip tone="info">{ROLE_LABEL[u.role] ?? u.role}</Chip></td>
                <td><button className="btn" disabled={del.isPending} aria-label={`Remove ${ROLE_LABEL[u.role] ?? u.role} from ${u.email}`} onClick={() => { if (confirm(`Remove ${ROLE_LABEL[u.role] ?? u.role} from ${u.email}?`)) del.mutate(u.id); }}>Remove</button></td></tr>
            ))}</tbody></table>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); add.mutate(); }} style={{ marginTop: 12 }}>
          <h2>Assign a role</h2>
          <div className="grid">
            <Field label="Work email"><input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" /></Field>
            <Field label="Role"><select value={role} onChange={(e) => setRole(e.target.value)}>{iAmSuper && <option value="super_admin">Super admin (every control)</option>}<option value="hr_admin">HR admin</option><option value="finance_signatory">Finance signatory</option></select></Field>
          </div>
          <ErrorNote error={add.error} />
          <p><button className="btn p" disabled={add.isPending}>Assign role</button></p>
        </form>
      </Card>
      <Card>
        <h2>What each role can do</h2>
        <p className="k">Access is enforced by the server, not just hidden in the menu. Anything marked logged records who looked, what, and when.</p>
        <div style={{ overflowX: "auto" }}>
          <table className="t"><thead><tr><th scope="col">What</th><th scope="col">HR admin</th><th scope="col">Finance signatory</th><th scope="col">Manager</th><th scope="col">Team member</th></tr></thead>
            {MATRIX.map(([g, rows]) => (
              <tbody key={g}><tr><th scope="rowgroup" colSpan={5} style={{ background: "#fafbfd", fontWeight: 600 }}>{g}</th></tr>
                {rows.map((r) => <tr key={r[0]}><th scope="row" style={{ fontWeight: 400, textAlign: "left" }}>{r[0]}</th>{r.slice(1).map((v, i) => <td key={i}><span className={`chip ${tone(v)}`}>{v}</span></td>)}</tr>)}
              </tbody>))}
          </table>
        </div>
      </Card>
    </Page>
  );
}
