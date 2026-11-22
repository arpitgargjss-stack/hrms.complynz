import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fileToBase64, getAuthToken } from "../lib/api";
import { ConfigHint } from "../lib/ConfigHint";
import { Card, Chip, ErrorNote, Field, Page, inr } from "../lib/ui";
import { celebrate } from "../lib/gz";

type Me = { email: string; employeeId: string | null; roles: string[] };
type Flag = { code: string; message: string; blocking: boolean };
type Claim = {
  id: string; month: string; category: string; mode: string | null; description: string; distanceKm: number | null; amountPaise: number; expenseDate: string;
  status: string; policyFlags: Flag[] | null; decisionNote: string | null; billFileId?: string | null;
};
type MyMonth = { month: string; totalPaise: number; approvedPaise: number; paidPaise: number; netSalaryPaise: number | null; claims: Claim[] };
type QueueClaim = Claim & { hasBill: boolean; employee: { code: string; name: string; department: string | null }; approverTier: string | null };
type Policy = { ratePerKmPaise: Record<string, number>; billRequiredAbovePaise: number; managerApprovalAbovePaise: number; ceoApprovalAbovePaise: number; submitWithinDays: number; cityCaps?: Record<string, number> };
type Bucket = { key: string; totalPaise: number; count: number };
type Analytics = { months: string[]; trend: { month: string; totalPaise: number; count: number }[]; byCategory: Bucket[]; byDepartment: Bucket[]; byMode: Bucket[]; totalPaise: number; count: number };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthLabel = (m: string) => `${FULL[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const thisMonth = () => new Date().toISOString().slice(0, 7);
const today = () => new Date().toISOString().slice(0, 10);
const titleCase = (s: string) => s.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const tone = (s: string) => (s === "approved" || s === "paid" ? "ok" : s === "rejected" ? "bad" : s === "submitted" ? "warn" : "info") as "ok" | "bad" | "warn" | "info";
const tableWrap = { overflowX: "auto" as const };
const PALETTE = ["#0048e4", "#1f9d6b", "#93c5fd", "#1d4ed8", "#64748b", "#2a8fa8"];

async function openBill(claimId: string) {
  const w = window.open("", "_blank");
  try {
    const token = await getAuthToken();
    const res = await fetch(`/api/reimbursement/claims/${claimId}/bill`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error((j as { error?: string }).error ?? res.statusText); }
    const url = URL.createObjectURL(await res.blob());
    if (w) w.location.href = url; else window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 120_000);
  } catch (e) { w?.close(); alert((e as Error).message); }
}

export default function Reimbursements() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
  const roles = new Set(me.data?.roles ?? []);
  const isHr = roles.has("hr_admin"), isFin = roles.has("finance_signatory"), isMgr = roles.has("manager");
  const reviewer = isHr || isFin || isMgr, admin = isHr || isFin;
  const [tab, setTab] = useState("mine");
  const tabs: [string, string][] = [["mine", "My claims"], ...(reviewer ? [["queue", "Claims queue"]] as [string, string][] : []), ...(admin ? [["analytics", "Analytics"], ["policy", "Policy"]] as [string, string][] : [])];
  return (
    <Page title="Reimbursements">
      {tabs.length > 1 && <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>}
      {tab === "mine" && <Mine />}
      {tab === "queue" && reviewer && <Queue />}
      {tab === "analytics" && admin && <AnalyticsTab />}
      {tab === "policy" && admin && <><ConfigHint tab="pay" label="Pay and money" /><PolicyTab canEdit={isHr || isFin} /></>}
    </Page>
  );
}

function FlagList({ flags }: { flags: Flag[] | null | undefined }) {
  if (!flags?.length) return null;
  return <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>{flags.map((f) => <Chip key={f.code} tone={f.blocking ? "bad" : "warn"}>{f.message}</Chip>)}</div>;
}

// ------------------------------------------------------------------ My claims
function Mine() {
  const qc = useQueryClient();
  const mine = useQuery({ queryKey: ["my-reimb"], queryFn: () => api<{ months: MyMonth[] }>("/me/reimbursements") });
  const policy = useQuery({ queryKey: ["reimb-policy"], queryFn: () => api<{ configured: boolean; settings: Policy | null }>("/reimbursement/policy") });
  const blank = { category: "expense", mode: "", description: "", distance: "", amount: "", date: today(), month: thisMonth() };
  const [f, setF] = useState(blank);
  const [bill, setBill] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const [flags, setFlags] = useState<Flag[]>([]);
  const p = policy.data?.settings;
  const rate = f.category === "travel" && f.mode && p ? p.ratePerKmPaise[f.mode.trim()] : undefined;
  const expected = rate !== undefined && Number(f.distance) > 0 ? Number(f.distance) * rate : null;
  const amountPaise = Math.round(Number(f.amount || 0) * 100);
  const needsBill = !!p && amountPaise > p.billRequiredAbovePaise && !bill;
  const submit = useMutation({
    mutationFn: async () => {
      setFlags([]);
      const body: Record<string, unknown> = { category: f.category, description: f.description, amountPaise, expenseDate: f.date, month: f.month };
      if (f.mode.trim()) body.mode = f.mode.trim();
      if (f.distance) body.distanceKm = Math.round(Number(f.distance));
      if (bill) body.bill = { name: bill.name, mime: bill.type, dataBase64: await fileToBase64(bill) };
      try { return await api("/reimbursement/claims", { body }); }
      catch (e) { throw e; }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["my-reimb"] }); setF({ ...blank, category: f.category }); setBill(null); setFileKey((k) => k + 1); celebrate("Claim submitted", "We'll let you know as it moves along"); },
  });
  const s = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const doSubmit = () => {
    if (bill && !["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(bill.type)) return alert("Bill must be a PDF, PNG, JPEG or WebP file.");
    if (expected !== null && expected !== amountPaise) setFlags([{ code: "rate_hint", message: `Policy rate gives ${inr(expected)} for this distance`, blocking: false }]);
    submit.mutate();
  };
  return (
    <>
      <Card>
        <h2>My months</h2>
        <ErrorNote error={mine.error} />
        {mine.isLoading ? <p>Loading…</p> : !mine.data?.months.length ? <p className="k">No claims yet. Spent money on work? Add the bill and we'll take it from there.</p> : mine.data.months.map((m) => (
          <details key={m.month} style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }}>
            <summary style={{ cursor: "pointer", minHeight: 44, display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 16px" }}>
              <strong>{monthLabel(m.month)}</strong><span>Claimed {inr(m.totalPaise)}</span><span>Approved {inr(m.approvedPaise)}</span>
              <span className="k">{m.netSalaryPaise !== null ? `Salary that month: ${inr(m.netSalaryPaise)} net` : "Salary not yet processed"}</span>
            </summary>
            <div style={tableWrap}><table className="t"><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>
              {m.claims.map((c) => (
                <tr key={c.id}><td>{c.expenseDate}</td><td>{titleCase(c.category)}{c.mode ? ` · ${titleCase(c.mode)}` : ""}{c.distanceKm ? ` · ${c.distanceKm} km` : ""}</td>
                  <td>{c.description}<FlagList flags={c.policyFlags} />{c.decisionNote && <div className="k">Note: {c.decisionNote}</div>}</td>
                  <td>{inr(c.amountPaise)}</td><td><Chip tone={tone(c.status)}>{titleCase(c.status)}</Chip></td>
                  <td>{c.billFileId && <button className="btn" onClick={() => openBill(c.id)}>Bill</button>}</td></tr>
              ))}
            </tbody></table></div>
          </details>
        ))}
      </Card>
      <Card>
        <h2>New claim</h2>
        {policy.data && !policy.data.configured && <div className="note warn">The reimbursement policy has not been set up yet, so claims cannot be submitted.</div>}
        {p && <p className="k">Bill required above {inr(p.billRequiredAbovePaise)}. Submit within {p.submitWithinDays} days of month end. Approval: finance up to {inr(p.managerApprovalAbovePaise)}, manager up to {inr(p.ceoApprovalAbovePaise)}, above that the CEO.</p>}
        <div className="grid">
          <Field label="Category"><select value={f.category} onChange={s("category")}><option value="expense">Expense</option><option value="travel">Travel</option><option value="technology">Technology</option></select></Field>
          <Field label="Mode (e.g. two_wheeler, taxi)"><input list="reimb-modes" value={f.mode} onChange={s("mode")} /><datalist id="reimb-modes">{p && Object.keys(p.ratePerKmPaise).map((k) => <option key={k} value={k} />)}</datalist></Field>
          <Field label="Distance (km)"><input inputMode="numeric" value={f.distance} onChange={s("distance")} /></Field>
          <Field label="Amount (rupees)"><input inputMode="decimal" value={f.amount} onChange={s("amount")} /></Field>
          <Field label="Expense date"><input type="date" value={f.date} onChange={s("date")} /></Field>
          <Field label="Claim month"><input type="month" value={f.month} onChange={s("month")} /></Field>
        </div>
        <Field label="Description"><textarea rows={2} value={f.description} onChange={s("description")} /></Field>
        <Field label={`Bill (PDF, PNG, JPEG or WebP)${needsBill ? " — required for this amount" : ""}`}><input key={fileKey} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setBill(e.target.files?.[0] ?? null)} /></Field>
        {expected !== null && <div className={`note ${expected === amountPaise ? "ok" : "warn"}`} style={{ marginTop: 12 }}>Policy rate: {inr(rate!)} per km, so {f.distance} km = {inr(expected)}.{expected !== amountPaise && " The amount must match."}</div>}
        {needsBill && <div className="note warn" style={{ marginTop: 12 }}>This amount needs a bill attached.</div>}
        {flags.map((x) => <div key={x.code} className="note warn">{x.message}</div>)}
        <div style={{ marginTop: 16 }}><button className="btn p" disabled={submit.isPending || !f.description.trim() || amountPaise <= 0 || !policy.data?.configured} onClick={doSubmit}>{submit.isPending ? "Submitting…" : "Submit claim"}</button></div>
        <ErrorNote error={submit.error} />
        {submit.isSuccess && <div className="note ok" style={{ marginTop: 12 }} role="status">Claim submitted.</div>}
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ Queue
function Queue() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const list = useQuery({ queryKey: ["reimb-queue", status], queryFn: () => api<QueueClaim[]>(`/reimbursement/claims${status ? `?status=${status}` : ""}`) });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "verify" | "approve" | "reject" }) => api(`/reimbursement/claims/${id}/${action}`, { body: notes[id]?.trim() ? { note: notes[id].trim() } : {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["reimb-queue"] }),
  });
  return (
    <Card>
      <div className="pagehead"><h2 style={{ margin: 0 }}>Claims queue</h2>
        <div style={{ minWidth: 200 }}><Field label="Status"><select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All</option>{["submitted", "verified", "manager_approved", "approved", "rejected", "paid"].map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}</select></Field></div></div>
      <p className="k">Finance verifies first. Then the approver for the amount tier approves: finance, the claimant's manager, or (for the highest tier) the manager and then HR recording the CEO sign-off with a note. A rejection needs a note. You cannot act on your own claim.</p>
      <ErrorNote error={list.error} /><ErrorNote error={act.error} />
      {list.isLoading ? <p>Loading…</p> : !list.data?.length ? <p className="k">Nothing here.</p> : (
        <div style={tableWrap}><table className="t"><thead><tr><th>Employee</th><th>Claim</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead><tbody>
          {list.data.map((c) => {
            const open = ["submitted", "verified", "manager_approved"].includes(c.status);
            return (
              <tr key={c.id}><td>{c.employee.name}<div className="k">{c.employee.code}{c.employee.department ? ` · ${c.employee.department}` : ""}</div></td>
                <td>{titleCase(c.category)}{c.mode ? ` · ${titleCase(c.mode)}` : ""}{c.distanceKm ? ` · ${c.distanceKm} km` : ""}<div>{c.description}</div><div className="k">{c.expenseDate} · {monthLabel(c.month)}</div><FlagList flags={c.policyFlags} />
                  {c.hasBill && <button className="btn" style={{ marginTop: 6 }} onClick={() => openBill(c.id)}>View bill</button>}</td>
                <td>{inr(c.amountPaise)}{c.approverTier && <div className="k">{c.approverTier} tier</div>}</td>
                <td><Chip tone={tone(c.status)}>{titleCase(c.status)}</Chip>{c.decisionNote && <div className="k">{c.decisionNote}</div>}</td>
                <td style={{ minWidth: 200 }}>{open && <>
                  <label className="k" htmlFor={`n-${c.id}`}>Note</label>
                  <input id={`n-${c.id}`} value={notes[c.id] ?? ""} onChange={(e) => setNotes({ ...notes, [c.id]: e.target.value })} />
                  <div className="row-gap" style={{ marginTop: 6 }}>
                    {c.status === "submitted" && <button className="btn p" disabled={act.isPending} onClick={() => act.mutate({ id: c.id, action: "verify" })}>Verify</button>}
                    {c.status !== "submitted" && <button className="btn p" disabled={act.isPending} onClick={() => act.mutate({ id: c.id, action: "approve" })}>Approve</button>}
                    <button className="btn" disabled={act.isPending || (notes[c.id]?.trim().length ?? 0) < 3} title="Enter a note of at least 3 characters to reject" onClick={() => act.mutate({ id: c.id, action: "reject" })}>Reject</button>
                  </div></>}</td></tr>
            );
          })}
        </tbody></table></div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ Analytics
function TrendChart({ data }: { data: Analytics["trend"] }) {
  const max = Math.max(1, ...data.map((d) => d.totalPaise));
  const W = 560, H = 200, pad = 28, bw = (W - pad * 2) / data.length;
  return (
    <svg viewBox={`0 0 ${W} ${H + 30}`} role="img" aria-label="Monthly reimbursement total" style={{ width: "100%", height: "auto", maxWidth: 640 }}>
      <line x1={pad} y1={H} x2={W - pad} y2={H} stroke="#d9dde8" />
      {data.map((d, i) => {
        const h = (d.totalPaise / max) * (H - 24), x = pad + i * bw + bw * 0.15;
        return <g key={d.month}><rect x={x} y={H - h} width={bw * 0.7} height={h} rx={3} fill="#0048e4"><title>{`${monthLabel(d.month)}: ${inr(d.totalPaise)} (${d.count} claims)`}</title></rect>
          <text x={x + bw * 0.35} y={H - h - 4} textAnchor="middle" fontSize="10" fill="#444c63">{d.totalPaise ? inr(d.totalPaise).replace(/\.00$/, "") : ""}</text>
          <text x={x + bw * 0.35} y={H + 16} textAnchor="middle" fontSize="11" fill="#5b6478">{MONTHS[Number(d.month.slice(5, 7)) - 1]}</text></g>;
      })}
    </svg>
  );
}

function PieChart({ data }: { data: Bucket[] }) {
  const total = data.reduce((s, d) => s + d.totalPaise, 0);
  if (!total) return <p className="k">No data.</p>;
  const R = 80, C = 90;
  let a0 = -Math.PI / 2;
  const slices = data.map((d, i) => {
    const frac = d.totalPaise / total, a1 = a0 + frac * Math.PI * 2;
    const pt = (a: number) => `${C + R * Math.cos(a)} ${C + R * Math.sin(a)}`;
    const path = frac >= 0.9999 ? `M ${C} ${C - R} A ${R} ${R} 0 1 1 ${C - 0.01} ${C - R} Z` : `M ${C} ${C} L ${pt(a0)} A ${R} ${R} 0 ${frac > 0.5 ? 1 : 0} 1 ${pt(a1)} Z`;
    a0 = a1;
    return { d, path, color: PALETTE[i % PALETTE.length], frac };
  });
  return (
    <div style={{ display: "flex", gap: 20, flexWrap: "wrap", alignItems: "center" }}>
      <svg viewBox="0 0 180 180" role="img" aria-label="Spend by category" style={{ width: 180, height: 180 }}>
        {slices.map((s) => <path key={s.d.key} d={s.path} fill={s.color} stroke="#fff" strokeWidth={2}><title>{`${titleCase(s.d.key)}: ${inr(s.d.totalPaise)}`}</title></path>)}
      </svg>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>{slices.map((s) => (
        <li key={s.d.key} style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 32 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: s.color, display: "inline-block" }} />{titleCase(s.d.key)}: {inr(s.d.totalPaise)} ({Math.round(s.frac * 100)}%)</li>))}
      </ul>
    </div>
  );
}

function BucketTable({ title, rows }: { title: string; rows: Bucket[] }) {
  return (
    <Card><h2>{title}</h2>
      {!rows.length ? <p className="k">No data.</p> : <div style={tableWrap}><table className="t"><thead><tr><th>{title.replace("By ", "")}</th><th>Claims</th><th>Total</th></tr></thead><tbody>
        {rows.map((r) => <tr key={r.key}><td>{titleCase(r.key)}</td><td>{r.count}</td><td>{inr(r.totalPaise)}</td></tr>)}
      </tbody></table></div>}
    </Card>
  );
}

function AnalyticsTab() {
  const [n, setN] = useState("6");
  const q = useQuery({ queryKey: ["reimb-analytics", n], queryFn: () => api<Analytics>(`/reimbursement/analytics?months=${n}`) });
  return (
    <>
      <div style={{ maxWidth: 240 }}><Field label="Period"><select value={n} onChange={(e) => setN(e.target.value)}><option value="3">Last 3 months</option><option value="6">Last 6 months</option><option value="12">Last 12 months</option></select></Field></div>
      <ErrorNote error={q.error} />
      {q.isLoading ? <p>Loading…</p> : q.data && (
        <>
          <Card><h2>Monthly trend</h2><p className="k">{inr(q.data.totalPaise)} across {q.data.count} claims. Rejected claims are excluded.</p><TrendChart data={q.data.trend} /></Card>
          <Card><h2>By category</h2><PieChart data={q.data.byCategory} /></Card>
          <div className="grid"><BucketTable title="By department" rows={q.data.byDepartment} /><BucketTable title="By mode" rows={q.data.byMode} /></div>
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------ Policy
export function PolicyTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["reimb-policy"], queryFn: () => api<{ configured: boolean; settings: Policy | null; updatedBy?: string }>("/reimbursement/policy") });
  const [f, setF] = useState<{ rates: string; caps: string; bill: string; mgr: string; ceo: string; days: string } | null>(null);
  const cur = q.data?.settings;
  const form = f ?? {
    rates: cur ? Object.entries(cur.ratePerKmPaise).map(([k, v]) => `${k},${v / 100}`).join("\n") : "",
    caps: cur?.cityCaps ? Object.entries(cur.cityCaps).map(([k, v]) => `${k},${v / 100}`).join("\n") : "",
    bill: cur ? String(cur.billRequiredAbovePaise / 100) : "", mgr: cur ? String(cur.managerApprovalAbovePaise / 100) : "", ceo: cur ? String(cur.ceoApprovalAbovePaise / 100) : "", days: cur ? String(cur.submitWithinDays) : "",
  };
  const parseMap = (t: string) => Object.fromEntries(t.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [k, v] = l.split(","); return [k.trim(), Math.round(Number(v) * 100)]; }));
  const save = useMutation({
    mutationFn: () => {
      const caps = parseMap(form.caps);
      const settings: Policy = { ratePerKmPaise: parseMap(form.rates), billRequiredAbovePaise: Math.round(Number(form.bill) * 100), managerApprovalAbovePaise: Math.round(Number(form.mgr) * 100), ceoApprovalAbovePaise: Math.round(Number(form.ceo) * 100), submitWithinDays: Math.round(Number(form.days)), ...(Object.keys(caps).length ? { cityCaps: caps } : {}) };
      return api("/reimbursement/policy", { method: "PUT", body: { settings } });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reimb-policy"] }); setF(null); },
  });
  const s = (k: keyof typeof form) => (e: { target: { value: string } }) => setF({ ...form, [k]: e.target.value });
  return (
    <Card>
      <h2>Reimbursement policy</h2>
      <ErrorNote error={q.error} />
      {q.data && !q.data.configured && <div className="note warn">Not configured yet. Enter the company policy values; none are pre-filled.</div>}
      {q.data?.updatedBy && <p className="k">Last updated by {q.data.updatedBy}. Each save creates a new version.</p>}
      <Field label="Per-km rates by mode, one per line as: mode, rupees per km (e.g. two_wheeler,5)"><textarea rows={4} value={form.rates} onChange={s("rates")} disabled={!canEdit} /></Field>
      <div className="grid">
        <Field label="Bill required above (rupees)"><input inputMode="decimal" value={form.bill} onChange={s("bill")} disabled={!canEdit} /></Field>
        <Field label="Manager approval above (rupees)"><input inputMode="decimal" value={form.mgr} onChange={s("mgr")} disabled={!canEdit} /></Field>
        <Field label="CEO approval above (rupees)"><input inputMode="decimal" value={form.ceo} onChange={s("ceo")} disabled={!canEdit} /></Field>
        <Field label="Submit within (days after month end)"><input inputMode="numeric" value={form.days} onChange={s("days")} disabled={!canEdit} /></Field>
      </div>
      <Field label="City caps (optional), one per line as: city, rupees"><textarea rows={3} value={form.caps} onChange={s("caps")} disabled={!canEdit} /></Field>
      {canEdit && <div style={{ marginTop: 16 }}><button className="btn p" disabled={save.isPending || !form.bill || !form.mgr || !form.ceo || !form.days} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save policy"}</button></div>}
      <ErrorNote error={save.error} />
      {save.isSuccess && <div className="note ok" style={{ marginTop: 12 }}>Policy saved.</div>}
    </Card>
  );
}
