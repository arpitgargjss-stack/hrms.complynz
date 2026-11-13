import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Card, Chip, ErrorNote, Field, Page } from "../lib/ui";
import { openHtml } from "../lib/openHtml";

type Candidate = { id: string; fullName: string; email: string; phone: string | null; position: string | null; status: string; expectedJoining: string | null };
type Letter = { id: string; type: string; refNo: string; status: string };
type Onb = { id: string; steps: string[]; expiresAt: string; completedAt: string | null; createdAt: string; submission: null | {
  personal: Record<string, unknown> | null; panMasked: string | null; accountMasked: string | null; bankName: string | null; ifsc: string | null;
  documents: { fileId: string; kind: string; name: string }[]; submittedAt: string | null } };
type Shared = { linkPath: string; expiresAt: string; emailed: boolean };

const tone = (s: string) => (s === "accepted" || s === "joined" || s === "issued" ? "ok" : s === "offered" ? "info" : s === "declined" ? "bad" : s === "draft" ? "warn" : "mute") as "ok" | "info" | "bad" | "warn" | "mute";
const STEPS = [
  { key: "details", label: "Personal details", hint: "Name, date of birth, phone, address" },
  { key: "kyc", label: "PAN", hint: "Stored encrypted; shown to HR masked" },
  { key: "bank", label: "Bank details", hint: "Bank name, account number, IFSC" },
  { key: "documents", label: "Document uploads", hint: "Photo, PAN card, ID, address proof, other" },
];
const typeLabel = (t: string) => (t === "offer_short" ? "Offer (summary)" : t === "offer_full" ? "Offer (full)" : t);

function CopyLink({ shared, title }: { shared: Shared; title: string }) {
  const [copied, setCopied] = useState(false);
  const url = window.location.origin + shared.linkPath;
  return (
    <div className="note ok" role="status">
      <strong>{title}</strong>
      <p style={{ margin: "6px 0" }}>Shown once. Copy it now; it cannot be retrieved later. Expires {shared.expiresAt.slice(0, 10)}. {shared.emailed ? "An email was sent to the candidate." : "Email was not sent, so share the link yourself."}</p>
      <div className="row-gap"><input readOnly value={url} aria-label="Link" style={{ flex: "1 1 260px" }} onFocus={(e) => e.currentTarget.select()} />
        <button className="btn p" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); } }}>{copied ? "Copied" : "Copy link"}</button></div>
    </div>
  );
}

function AddCandidate({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ fullName: "", email: "", phone: "", position: "", expectedJoining: "" });
  const m = useMutation({
    mutationFn: () => api("/candidates", { body: { fullName: f.fullName, email: f.email, phone: f.phone || undefined, position: f.position || undefined, expectedJoining: f.expectedJoining || undefined } }),
    onSuccess: () => { setF({ fullName: "", email: "", phone: "", position: "", expectedJoining: "" }); onDone(); },
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Card><h2>Add candidate</h2>
      <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <div className="grid">
          <Field label="Full name"><input required value={f.fullName} onChange={set("fullName")} /></Field>
          <Field label="Email"><input required type="email" value={f.email} onChange={set("email")} /></Field>
          <Field label="Phone"><input value={f.phone} onChange={set("phone")} inputMode="tel" /></Field>
          <Field label="Position"><input value={f.position} onChange={set("position")} /></Field>
          <Field label="Expected joining"><input type="date" value={f.expectedJoining} onChange={set("expectedJoining")} /></Field>
        </div>
        <ErrorNote error={m.error} />
        <p><button className="btn p" disabled={m.isPending}>Add candidate</button></p>
      </form>
    </Card>
  );
}

const PAYLOAD_FIELDS: { k: string; label: string; type?: string; money?: boolean }[] = [
  { k: "position", label: "Position" }, { k: "department", label: "Department" }, { k: "reportingTo", label: "Reporting to" }, { k: "location", label: "Work location" },
  { k: "joiningDate", label: "Date of joining", type: "date" }, { k: "employmentType", label: "Employment type" },
  { k: "annualCtc", label: "Annual CTC (INR)", type: "number", money: true }, { k: "monthlyGross", label: "Monthly gross (INR)", type: "number", money: true },
  { k: "validUntil", label: "Offer valid until", type: "date" }, { k: "probation", label: "Probation" }, { k: "noticePeriod", label: "Notice period" },
  { k: "workingHours", label: "Working hours" }, { k: "leaveSummary", label: "Leave entitlement" }, { k: "salaryStructureNote", label: "Salary structure reference" },
  { k: "signatoryName", label: "Signatory name" }, { k: "signatoryDesignation", label: "Signatory designation" },
];

function Letters({ c }: { c: Candidate }) {
  const qc = useQueryClient();
  const letters = useQuery({ queryKey: ["letters", c.id], queryFn: () => api<Letter[]>(`/letters?candidateId=${c.id}`) });
  const [form, setForm] = useState<Record<string, string>>({ position: c.position ?? "", joiningDate: c.expectedJoining ?? "" });
  const [shared, setShared] = useState<Shared | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["letters", c.id] }); qc.invalidateQueries({ queryKey: ["candidates"] }); };
  const create = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {};
      for (const f of PAYLOAD_FIELDS) { const v = (form[f.k] ?? "").trim(); if (!v) continue; payload[f.k] = f.money ? Math.round(Number(v) * 100) : v; }
      // Every hire gets both formats, from one payload.
      for (const type of ["offer_short", "offer_full"]) await api("/letters", { body: { type, candidateId: c.id, payload } });
    }, onSuccess: refresh,
  });
  const issue = useMutation({ mutationFn: (id: string) => api(`/letters/${id}/issue`, { method: "POST", body: {} }), onSuccess: refresh });
  const share = useMutation({ mutationFn: (id: string) => api<Shared>(`/letters/${id}/share`, { method: "POST", body: {} }), onSuccess: (s) => { setShared(s); refresh(); } });
  const list = letters.data ?? [];
  const issued = list.find((l) => l.status === "issued" && (l.type === "offer_short" || l.type === "offer_full"));
  const hasOffers = list.some((l) => l.type === "offer_short") && list.some((l) => l.type === "offer_full");
  return (
    <Card><h2>Offer letters</h2>
      {list.length > 0 && <div style={{ overflowX: "auto" }}><table className="t"><thead><tr><th>Letter</th><th>Ref</th><th>Status</th><th></th></tr></thead><tbody>
        {list.map((l) => <tr key={l.id}><td>{typeLabel(l.type)}</td><td>{l.refNo}</td><td><Chip tone={tone(l.status)}>{l.status}</Chip></td>
          <td className="row-gap"><button className="btn" onClick={() => openHtml(`/letters/${l.id}/html`)}>Preview</button>
            {l.status === "draft" && <button className="btn p" disabled={issue.isPending} onClick={() => issue.mutate(l.id)}>Issue</button>}</td></tr>)}
      </tbody></table></div>}
      <ErrorNote error={issue.error} />
      {issued && <div style={{ marginTop: 12 }}>
        <p className="k">One acceptance link covers both offer formats. The candidate verifies by a code sent to {c.email}.</p>
        <button className="btn p" disabled={share.isPending} onClick={() => share.mutate(issued.id)}>Share acceptance link</button>
        <ErrorNote error={share.error} />
      </div>}
      {shared && <CopyLink shared={shared} title="Acceptance link created" />}
      {!hasOffers && <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} style={{ marginTop: 12 }}>
        <p className="k">Create both the summary and full offer from these terms. Blank fields show as highlighted placeholders in the letter.</p>
        <div className="grid">{PAYLOAD_FIELDS.map((f) => <Field key={f.k} label={f.label}><input type={f.type ?? "text"} min={f.type === "number" ? 0 : undefined} value={form[f.k] ?? ""} onChange={(e) => setForm({ ...form, [f.k]: e.target.value })} /></Field>)}</div>
        <ErrorNote error={create.error} />
        <p><button className="btn p" disabled={create.isPending}>Create both offer letters</button></p>
      </form>}
    </Card>
  );
}

function Onboarding({ c }: { c: Candidate }) {
  const qc = useQueryClient();
  const [steps, setSteps] = useState<string[]>(["details", "kyc", "bank", "documents"]);
  const [shared, setShared] = useState<Shared | null>(null);
  const subs = useQuery({ queryKey: ["onb", c.id], queryFn: () => api<Onb[]>(`/candidates/${c.id}/onboarding`) });
  const create = useMutation({ mutationFn: () => api<Shared>(`/candidates/${c.id}/onboarding-link`, { body: { steps } }), onSuccess: (s) => { setShared(s); qc.invalidateQueries({ queryKey: ["onb", c.id] }); } });
  return (
    <Card><h2>Onboarding</h2>
      <p className="k">The candidate opens one link, verifies their email with a code, then completes the steps you tick.</p>
      <label className="ck" style={{ display: "flex", gap: 12, padding: "10px 0" }}><input type="checkbox" checked disabled /><span><strong>Verify email with a one-time code</strong><br /><span className="k">Always on</span></span></label>
      {STEPS.map((s) => <label key={s.key} style={{ display: "flex", gap: 12, padding: "10px 0", borderTop: "1px solid #eceef4", alignItems: "flex-start" }}>
        <input type="checkbox" checked={steps.includes(s.key)} onChange={(e) => setSteps(e.target.checked ? [...steps, s.key] : steps.filter((x) => x !== s.key))} />
        <span><strong>{s.label}</strong><br /><span className="k">{s.hint}</span></span></label>)}
      <ErrorNote error={create.error} />
      <p><button className="btn p" disabled={create.isPending || !steps.length} onClick={() => create.mutate()}>Create onboarding link</button></p>
      {shared && <CopyLink shared={shared} title="Onboarding link created" />}
      {(subs.data ?? []).map((o) => <div key={o.id} style={{ borderTop: "1px solid #eceef4", paddingTop: 10, marginTop: 10 }}>
        <p style={{ margin: 0 }}><Chip tone={o.completedAt ? "ok" : "warn"}>{o.completedAt ? "Submitted" : "Waiting"}</Chip> <span className="k">Link created {o.createdAt.slice(0, 10)}, expires {o.expiresAt.slice(0, 10)}, steps: {o.steps.join(", ")}</span></p>
        {o.submission && <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "4px 16px", fontSize: 14 }}>
          {Object.entries(o.submission.personal ?? {}).map(([k, v]) => <><dt className="k" key={k + "k"}>{k}</dt><dd key={k} style={{ margin: 0 }}>{String(v)}</dd></>)}
          {o.submission.panMasked && <><dt className="k">PAN</dt><dd style={{ margin: 0 }}>{o.submission.panMasked}</dd></>}
          {o.submission.bankName && <><dt className="k">Bank</dt><dd style={{ margin: 0 }}>{o.submission.bankName}, IFSC {o.submission.ifsc}, account {o.submission.accountMasked}</dd></>}
          <dt className="k">Documents</dt><dd style={{ margin: 0 }}>{o.submission.documents.length ? o.submission.documents.map((d) => `${d.kind}: ${d.name}`).join("; ") : "None"}</dd>
        </dl>}
      </div>)}
    </Card>
  );
}

function Convert({ c, onDone }: { c: Candidate; onDone: () => void }) {
  const [f, setF] = useState({ workEmail: "", joiningDate: c.expectedJoining ?? "" });
  const m = useMutation({ mutationFn: () => api<{ id: string; code: string }>(`/candidates/${c.id}/convert`, { body: { workEmail: f.workEmail, joiningDate: f.joiningDate || undefined } }), onSuccess: onDone });
  if (c.status === "joined") return <Card><h2>Employee record</h2><p>This candidate has joined and has an employee record.</p></Card>;
  return (
    <Card><h2>Convert to employee</h2>
      <p className="k">Needs a completed onboarding submission. Creates the employee record from the submitted details.</p>
      <form onSubmit={(e) => { e.preventDefault(); if (window.confirm(`Create an employee record for ${c.fullName}?`)) m.mutate(); }}>
        <div className="grid"><Field label="Work email"><input required type="email" value={f.workEmail} onChange={(e) => setF({ ...f, workEmail: e.target.value })} /></Field>
          <Field label="Joining date"><input type="date" value={f.joiningDate} onChange={(e) => setF({ ...f, joiningDate: e.target.value })} /></Field></div>
        <ErrorNote error={m.error} />
        {m.data && <div className="note ok" role="status">Employee {m.data.code} created.</div>}
        <p><button className="btn p" disabled={m.isPending}>Convert to employee</button></p>
      </form>
    </Card>
  );
}

export default function Hiring() {
  const qc = useQueryClient();
  const [sel, setSel] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const list = useQuery({ queryKey: ["candidates"], queryFn: () => api<Candidate[]>("/candidates") });
  const c = (list.data ?? []).find((x) => x.id === sel);
  return (
    <Page title="Hiring" actions={<button className="btn p" onClick={() => setAdding(!adding)}>{adding ? "Close" : "Add candidate"}</button>}>
      <ErrorNote error={list.error} />
      {adding && <AddCandidate onDone={() => { setAdding(false); qc.invalidateQueries({ queryKey: ["candidates"] }); }} />}
      <Card>
        {list.isLoading ? <p>Loading…</p> : !(list.data ?? []).length ? <p>No candidates yet.</p> : <div style={{ overflowX: "auto" }}><table className="t">
          <thead><tr><th>Name</th><th>Position</th><th>Expected joining</th><th>Status</th><th></th></tr></thead>
          <tbody>{list.data!.map((x) => <tr key={x.id} style={x.id === sel ? { background: "#f3f5fd" } : undefined}>
            <td>{x.fullName}<br /><span className="k">{x.email}</span></td><td>{x.position ?? "-"}</td><td>{x.expectedJoining ?? "-"}</td><td><Chip tone={tone(x.status)}>{x.status}</Chip></td>
            <td><button className="btn" onClick={() => setSel(x.id === sel ? null : x.id)}>{x.id === sel ? "Hide" : "Open"}</button></td></tr>)}</tbody></table></div>}
      </Card>
      {c && <><h2>{c.fullName}</h2><Letters key={"l" + c.id} c={c} /><Onboarding key={"o" + c.id} c={c} /><Convert key={"c" + c.id} c={c} onDone={() => qc.invalidateQueries({ queryKey: ["candidates"] })} /></>}
    </Page>
  );
}
