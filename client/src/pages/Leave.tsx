import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Card, Chip, ErrorNote, Field, Page } from "../lib/ui";
import { celebrate } from "../lib/gz";

type Me = { email: string; employeeId: string | null; roles: string[] };
type Balance = { leaveTypeId: string; key: string; name: string; paid: boolean; entitledX2: number; available: number; used: number; pending: number };
type Req = { id: string; leaveTypeId: string; fromDate: string; toDate: string; halfDay: boolean; days2: number; reason: string | null; status: string; decisionNote: string | null };
type LType = { id: string; key: string; name: string; annualQuotaHalfDays: number; carryForwardHalfDays: number; paid: boolean; accrual: "upfront" | "monthly"; requiresNote: boolean; active: boolean };
type AdminReq = { id: string; employeeId: string; code: string; employeeName: string; leaveType: string; fromDate: string; toDate: string; halfDay: boolean; days2: number; reason: string | null; status: string; decidedBy: string | null; decisionNote: string | null };

const d = (x2: number) => (x2 / 2).toString();
const tone = (s: string) => (s === "approved" ? "ok" : s === "pending" ? "warn" : s === "rejected" ? "bad" : "mute") as "ok" | "warn" | "bad" | "mute";

function Mine() {
  const qc = useQueryClient();
  const data = useQuery({ queryKey: ["myLeave"], queryFn: () => api<{ year: number; balances: Balance[]; requests: Req[] }>("/me/leave") });
  const types = useQuery({ queryKey: ["leaveTypes"], queryFn: () => api<LType[]>("/leave/types") });
  const [f, setF] = useState({ leaveTypeId: "", fromDate: "", toDate: "", halfDay: false, reason: "" });
  const apply = useMutation({
    mutationFn: () => api("/leave/requests", { body: { leaveTypeId: f.leaveTypeId, fromDate: f.fromDate, toDate: f.halfDay ? f.fromDate : f.toDate || f.fromDate, halfDay: f.halfDay, reason: f.reason || undefined } }),
    onSuccess: () => { setF({ leaveTypeId: "", fromDate: "", toDate: "", halfDay: false, reason: "" }); qc.invalidateQueries({ queryKey: ["myLeave"] }); celebrate("Sent to your manager", "You'll see it here the moment it's approved"); },
  });
  const cancel = useMutation({ mutationFn: (id: string) => api(`/leave/requests/${id}/cancel`, { method: "POST", body: {} }), onSuccess: () => qc.invalidateQueries({ queryKey: ["myLeave"] }) });
  const name = (id: string) => data.data?.balances.find((b) => b.leaveTypeId === id)?.name ?? "Leave";
  const sel = types.data?.find((t) => t.id === f.leaveTypeId);
  return (
    <>
      <ErrorNote error={data.error} />
      <div className="grid">{(data.data?.balances ?? []).map((b) => <Card key={b.leaveTypeId}>
        <div className="k">{b.name}{b.paid ? "" : " (unpaid)"}</div>
        <div style={{ fontSize: 28, fontWeight: 600 }}>{d(b.available)} <span className="k">days available</span></div>
        <div className="k">Entitled {d(b.entitledX2)} · used {d(b.used)} · pending {d(b.pending)}</div></Card>)}</div>
      <Card><h2>Apply for leave</h2>
        <form onSubmit={(e) => { e.preventDefault(); apply.mutate(); }}>
          <div className="grid">
            <Field label="Leave type"><select required value={f.leaveTypeId} onChange={(e) => setF({ ...f, leaveTypeId: e.target.value })}><option value="">Select…</option>{(types.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
            <Field label={f.halfDay ? "Date" : "From"}><input type="date" required value={f.fromDate} onChange={(e) => setF({ ...f, fromDate: e.target.value })} /></Field>
            {!f.halfDay && <Field label="To"><input type="date" min={f.fromDate} value={f.toDate} onChange={(e) => setF({ ...f, toDate: e.target.value })} /></Field>}
          </div>
          <label style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 44 }}><input type="checkbox" checked={f.halfDay} onChange={(e) => setF({ ...f, halfDay: e.target.checked })} />Half day</label>
          <Field label={sel?.requiresNote ? "Reason (required)" : "Reason (optional)"}><textarea rows={3} maxLength={500} required={!!sel?.requiresNote} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
          <ErrorNote error={apply.error} />{apply.isSuccess && <div className="note ok" role="status">Request sent for approval.</div>}
          <p><button className="btn p" disabled={apply.isPending}>Apply</button></p>
        </form>
      </Card>
      <Card><h2>My requests</h2><ErrorNote error={cancel.error} />
        <div style={{ overflowX: "auto" }}><table className="t"><thead><tr><th>Type</th><th>Dates</th><th>Days</th><th>Status</th><th></th></tr></thead><tbody>
          {(data.data?.requests ?? []).map((r) => <tr key={r.id}><td>{name(r.leaveTypeId)}{r.reason && <><br /><span className="k">{r.reason}</span></>}</td>
            <td>{r.fromDate}{r.toDate !== r.fromDate ? ` to ${r.toDate}` : ""}{r.halfDay ? " (half day)" : ""}</td><td>{d(r.days2)}</td>
            <td><Chip tone={tone(r.status)}>{r.status}</Chip>{r.decisionNote && <><br /><span className="k">{r.decisionNote}</span></>}</td>
            <td>{(r.status === "pending" || (r.status === "approved" && r.fromDate > new Date().toISOString().slice(0, 10))) && <button className="btn" disabled={cancel.isPending} onClick={() => window.confirm("Cancel this request?") && cancel.mutate(r.id)}>Cancel</button>}</td></tr>)}
          {data.data && !data.data.requests.length && <tr><td colSpan={5}>No requests this year.</td></tr>}
        </tbody></table></div>
      </Card>
    </>
  );
}

function Requests() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("pending");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const q = useQuery({ queryKey: ["leaveQueue", status], queryFn: () => api<AdminReq[]>(`/leave/requests${status ? "?status=" + status : ""}`) });
  const decide = useMutation({ mutationFn: (a: { id: string; action: "approve" | "reject" }) => api(`/leave/requests/${a.id}/${a.action}`, { body: { note: notes[a.id]?.trim() || undefined } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["leaveQueue"] }) });
  return (
    <Card><div className="row-gap" style={{ alignItems: "end", justifyContent: "space-between" }}><h2>Leave requests</h2>
      <Field label="Status"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="">All</option></select></Field></div>
      <ErrorNote error={q.error || decide.error} />
      <div style={{ overflowX: "auto" }}><table className="t"><thead><tr><th>Person</th><th>Leave</th><th>Dates</th><th>Days</th><th>Status</th><th>Decision</th></tr></thead><tbody>
        {(q.data ?? []).map((r) => <tr key={r.id}><td>{r.employeeName}<br /><span className="k">{r.code}</span></td><td>{r.leaveType}{r.reason && <><br /><span className="k">{r.reason}</span></>}</td>
          <td>{r.fromDate}{r.toDate !== r.fromDate ? ` to ${r.toDate}` : ""}{r.halfDay ? " (half)" : ""}</td><td>{d(r.days2)}</td><td><Chip tone={tone(r.status)}>{r.status}</Chip></td>
          <td>{r.status === "pending" ? <div style={{ minWidth: 200 }}>
            <input aria-label={`Note for ${r.employeeName}`} placeholder="Note (optional)" value={notes[r.id] ?? ""} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
            <div className="row-gap" style={{ marginTop: 6 }}><button className="btn p" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, action: "approve" })}>Approve</button>
              <button className="btn" disabled={decide.isPending} onClick={() => decide.mutate({ id: r.id, action: "reject" })}>Reject</button></div></div>
            : <span className="k">{r.decidedBy ?? ""}{r.decisionNote ? `: ${r.decisionNote}` : ""}</span>}</td></tr>)}
        {q.data && !q.data.length && <tr><td colSpan={6}>Nothing here.</td></tr>}
      </tbody></table></div>
    </Card>
  );
}

const blank = { id: "", key: "", name: "", annualQuotaDays: "12", carryForwardDays: "0", paid: true, accrual: "monthly" as "monthly" | "upfront", requiresNote: false, active: true };
function Types() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["leaveTypesAll"], queryFn: () => api<LType[]>("/leave/types/all") });
  const [f, setF] = useState(blank);
  const done = () => { setF(blank); qc.invalidateQueries({ queryKey: ["leaveTypesAll"] }); qc.invalidateQueries({ queryKey: ["leaveTypes"] }); };
  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.name, annualQuotaHalfDays: Math.round(Number(f.annualQuotaDays) * 2), carryForwardHalfDays: Math.round(Number(f.carryForwardDays) * 2), paid: f.paid, accrual: f.accrual, requiresNote: f.requiresNote, active: f.active };
      return f.id ? api(`/leave/types/${f.id}`, { method: "PUT", body }) : api("/leave/types", { body: { ...body, key: f.key } });
    }, onSuccess: done,
  });
  const del = useMutation({ mutationFn: (id: string) => api(`/leave/types/${id}`, { method: "DELETE" }), onSuccess: done });
  return (
    <Card><h2>Leave types</h2>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid">
          {!f.id && <Field label="Key (lowercase, e.g. casual)"><input required pattern="[a-z][a-z0-9_]{1,30}" value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} /></Field>}
          <Field label="Name"><input required maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Annual quota (days)"><input type="number" min={0} step={0.5} required value={f.annualQuotaDays} onChange={(e) => setF({ ...f, annualQuotaDays: e.target.value })} /></Field>
          <Field label="Carry forward (days)"><input type="number" min={0} step={0.5} value={f.carryForwardDays} onChange={(e) => setF({ ...f, carryForwardDays: e.target.value })} /></Field>
          <Field label="Accrual"><select value={f.accrual} onChange={(e) => setF({ ...f, accrual: e.target.value as "monthly" | "upfront" })}><option value="monthly">Monthly</option><option value="upfront">Upfront</option></select></Field>
        </div>
        {([["paid", "Paid leave"], ["requiresNote", "Reason is required"], ["active", "Active"]] as const).map(([k, l]) => <label key={k} style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 44 }}><input type="checkbox" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />{l}</label>)}
        <ErrorNote error={save.error || del.error} />
        <p className="row-gap"><button className="btn p" disabled={save.isPending}>{f.id ? "Update type" : "Add type"}</button>{f.id && <button type="button" className="btn" onClick={() => setF(blank)}>Cancel edit</button>}</p>
      </form>
      <div style={{ overflowX: "auto" }}><table className="t"><thead><tr><th>Name</th><th>Quota</th><th>Carry</th><th>Accrual</th><th>Flags</th><th></th></tr></thead><tbody>
        {(q.data ?? []).map((t) => <tr key={t.id}><td>{t.name}<br /><span className="k">{t.key}</span></td><td>{d(t.annualQuotaHalfDays)}</td><td>{d(t.carryForwardHalfDays)}</td><td>{t.accrual}</td>
          <td>{t.paid ? <Chip tone="ok">Paid</Chip> : <Chip>Unpaid</Chip>} {t.requiresNote && <Chip tone="info">Reason</Chip>} {!t.active && <Chip tone="warn">Inactive</Chip>}</td>
          <td className="row-gap"><button className="btn" onClick={() => setF({ id: t.id, key: t.key, name: t.name, annualQuotaDays: d(t.annualQuotaHalfDays), carryForwardDays: d(t.carryForwardHalfDays), paid: t.paid, accrual: t.accrual, requiresNote: t.requiresNote, active: t.active })}>Edit</button>
            <button className="btn" onClick={() => window.confirm(`Remove ${t.name}? If it has requests it is deactivated instead.`) && del.mutate(t.id)}>Remove</button></td></tr>)}
      </tbody></table></div>
    </Card>
  );
}

export default function Leave() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
  const roles = me.data?.roles ?? [];
  const hr = roles.includes("hr_admin"), approver = hr || roles.includes("manager");
  const tabs = [{ k: "mine", l: "My leave" }, ...(approver ? [{ k: "requests", l: "Requests" }] : []), ...(hr ? [{ k: "types", l: "Leave types" }, { k: "cal", l: "Work calendar" }, { k: "hol", l: "Holidays" }] : [])];
  const [tab, setTab] = useState("mine");
  return (
    <Page title="Leave">
      <div className="tabs" role="tablist">{tabs.map((t) => <button key={t.k} role="tab" aria-selected={tab === t.k} className={tab === t.k ? "on" : ""} onClick={() => setTab(t.k)}>{t.l}</button>)}</div>
      {tab === "mine" && <Mine />}{tab === "requests" && <Requests />}{tab === "types" && <Types />}
      {(tab === "cal" || tab === "hol") && <Card><p>The work calendar and holidays are managed on the Attendance page, under the {tab === "cal" ? "Work calendar" : "Holidays"} tab.</p><Link href="/attendance" className="btn p" style={{ display: "inline-block", textDecoration: "none", lineHeight: "24px" }}>Open Attendance</Link></Card>}
    </Page>
  );
}
