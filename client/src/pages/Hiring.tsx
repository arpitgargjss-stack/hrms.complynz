import { Link } from "wouter";
import { useEffect, useState } from "react";
import { KIND_LABEL, candidateSteps, type ChecklistItem, type LinkChecklist } from "../../../shared/hr/onboardingChecklist";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LETTER_STATUS_LABEL, letterDef } from "../../../shared/hr/letters";
import { FieldInput } from "./Letters";
import { DataTable } from "../lib/DataTable";
import { api } from "../lib/api";
import { Card, Chip, ErrorNote, Field, Page } from "../lib/ui";
import { openHtml } from "../lib/openHtml";

type Candidate = { id: string; fullName: string; email: string; phone: string | null; position: string | null; status: string; expectedJoining: string | null };
type Letter = { id: string; type: string; refNo: string; status: string; reviewNote?: string | null };
type Onb = { id: string; steps: string[]; expiresAt: string; completedAt: string | null; createdAt: string; checklist?: LinkChecklist | null; submission: null | {
  personal: Record<string, unknown> | null; panMasked: string | null; accountMasked: string | null; bankName: string | null; ifsc: string | null;
  documents: { fileId: string; kind: string; name: string }[]; submittedAt: string | null } };
type Shared = { linkPath: string; expiresAt: string; emailed: boolean };

const tone = (s: string) => (s === "accepted" || s === "joined" || s === "issued" ? "ok" : s === "offered" ? "info" : s === "declined" ? "bad" : s === "draft" ? "warn" : "mute") as "ok" | "info" | "bad" | "warn" | "mute";
const STEPS = [
  { key: "details", label: "Personal details", hint: "Name, date of birth, phone, address" },
  { key: "kyc", label: "PAN", hint: "Stored encrypted; shown to HR masked" },
  { key: "bank", label: "Bank details", hint: "Bank name, account number (typed twice), IFSC, and a cheque, passbook or banking screenshot as proof" },
  { key: "documents", label: "Document uploads", hint: "Photo, PAN card, ID, address proof, other" },
];
const typeLabel = (t: string) => (t === "offer_short" ? "Offer, one page" : t === "offer_full" ? "Offer, full" : t);

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

/** One form fills both offer formats: the full letter's fields plus the one-page letter's salary note. */
const OFFER_FIELDS = [...letterDef("offer_full")!.fields, ...letterDef("offer_short")!.fields.filter((f) => f.key === "salaryNote")];

function ConsentChoices({ c }: { c: Candidate }) {
  const q = useQuery({ queryKey: ["cand-consents", c.id], queryFn: () => api<{ key: string; title: string; granted: boolean | null; at: string | null }[] | null>(`/candidates/${c.id}/consents`) });
  if (!q.data) return <Card><h2>Data consents</h2><p className="k">{q.isLoading ? "Loading…" : "Recorded when the candidate accepts the offer online: one yes or no for each purpose. They move to the employee's consent log on joining."}</p></Card>;
  return <Card><h2>Data consents recorded at acceptance</h2>
    <table className="t"><thead><tr><th>Purpose</th><th>Choice</th><th>When</th></tr></thead><tbody>{q.data.map((r) => <tr key={r.key}><td>{r.title}</td>
      <td>{r.granted == null ? "-" : <Chip tone={r.granted ? "ok" : "mute"}>{r.granted ? "Yes" : "No"}</Chip>}</td><td className="k">{r.at ? new Date(r.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : ""}</td></tr>)}</tbody></table>
    <p className="k">{c.status === "joined" ? "Copied to the employee's consent log on joining." : "These move to the employee's consent log automatically when you convert the candidate."}</p></Card>;
}

function Letters({ c }: { c: Candidate }) {
  const qc = useQueryClient();
  const letters = useQuery({ queryKey: ["letters", c.id], queryFn: () => api<Letter[]>(`/letters?candidateId=${c.id}`) });
  const [form, setForm] = useState<Record<string, unknown>>({ position: c.position ?? undefined, joiningDate: c.expectedJoining ?? undefined, templateKey: "standard", employmentType: "Full-Time, Permanent" });
  const [shared, setShared] = useState<Shared | null>(null);
  // Next employee code, today's date for the NDA, and what the candidate gave in onboarding (address, NDA details). Typed values win.
  useEffect(() => { api<{ values?: Record<string, unknown> }>(`/letters/prefill?candidateId=${c.id}`).then((r) => setForm((cur) => ({ ...Object.fromEntries(Object.entries(r.values ?? {}).filter(([, v]) => v != null && v !== "")), ...Object.fromEntries(Object.entries(cur).filter(([, v]) => v != null && v !== "")) }))).catch(() => {}); }, [c.id]);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["letters", c.id] }); qc.invalidateQueries({ queryKey: ["candidates"] }); };
  const create = useMutation({
    mutationFn: async () => {
      const payload = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== undefined && v !== ""));
      // Every hire gets both formats, from one payload.
      // Only the formats that are missing (one may have been discarded).
      for (const type of ["offer_short", "offer_full"]) if (!list.some((l) => l.type === type && l.status !== "void")) await api("/letters", { body: { type, candidateId: c.id, payload } });
    }, onSuccess: refresh,
  });
  const discard = useMutation({ mutationFn: (id: string) => api(`/letters/${id}`, { method: "DELETE" }), onSuccess: refresh });
  const issue = useMutation({ mutationFn: (a: { id: string; step: string }) => api(`/letters/${a.id}/${a.step}`, { method: "POST", body: {} }), onSuccess: refresh });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ roles: string[] }>("/me") });
  const ceo = !!me.data?.roles.includes("super_admin");
  const share = useMutation({ mutationFn: (id: string) => api<Shared>(`/letters/${id}/share`, { method: "POST", body: {} }), onSuccess: (s) => { setShared(s); refresh(); } });
  const list = letters.data ?? [];
  const issued = list.find((l) => l.status === "issued" && (l.type === "offer_short" || l.type === "offer_full"));
  const hasOffers = list.some((l) => l.type === "offer_short") && list.some((l) => l.type === "offer_full");
  return (
    <Card><h2>Offer letters</h2>
      {list.length > 0 && <div style={{ overflowX: "auto" }}><table className="t"><thead><tr><th>Letter</th><th>Ref</th><th>Status</th><th></th></tr></thead><tbody>
        {list.map((l) => <tr key={l.id}><td>{typeLabel(l.type)}</td><td>{l.refNo}</td><td><Chip tone={tone(l.status)}>{LETTER_STATUS_LABEL[l.status] ?? l.status}</Chip>{l.reviewNote && l.status === "draft" && <div className="k">CEO note: {l.reviewNote}</div>}</td>
          <td className="row-gap"><button className="btn" onClick={() => openHtml(`/letters/${l.id}/html`)}>Preview</button>
            {(l.status === "draft" || l.status === "pending_approval") && ceo && <button className="btn p" disabled={issue.isPending} onClick={() => issue.mutate({ id: l.id, step: "approve" })}>Approve as CEO</button>}
            {l.status === "draft" && !ceo && <button className="btn p" disabled={issue.isPending} onClick={() => issue.mutate({ id: l.id, step: "submit" })}>Send to CEO</button>}
            {l.status === "approved" && <button className="btn p" disabled={issue.isPending} onClick={() => issue.mutate({ id: l.id, step: "issue" })}>Issue</button>}
            {(l.status === "draft" || l.status === "pending_approval") && <button className="btn" disabled={discard.isPending} onClick={() => { if (window.confirm(`Discard ${typeLabel(l.type)} (${l.refNo})? You can create it again below.`)) discard.mutate(l.id); }}>Discard draft</button>}</td></tr>)}
      </tbody></table></div>}
      <ErrorNote error={issue.error ?? discard.error} />
      {issued && <div style={{ marginTop: 12 }}>
        <p className="k">One acceptance link covers both offer formats. The candidate verifies by a code sent to {c.email}.</p>
        <button className="btn p" disabled={share.isPending} onClick={() => share.mutate(issued.id)}>Share acceptance link</button>
        <ErrorNote error={share.error} />
      </div>}
      {shared && <CopyLink shared={shared} title="Acceptance link created" />}
      {!hasOffers && <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} style={{ marginTop: 12 }}>
        <p className="k">Creates both the one-page and the full offer letter from these terms. Blank fields show as highlighted placeholders. Both go to the CEO for approval before they can be issued.</p>
        <div className="grid">{OFFER_FIELDS.map((f) => <Field key={f.key} label={f.label}><FieldInput f={f} v={form[f.key]} set={(x) => setForm({ ...form, [f.key]: x })} />{f.hint && <span className="k">{f.hint}</span>}</Field>)}</div>
        <ErrorNote error={create.error} />
        <p><button className="btn p" disabled={create.isPending}>Create both offer letters</button></p>
      </form>}
    </Card>
  );
}

const PERSONAL_LABEL: Record<string, string> = { fullName: "Full name", relationName: "Father's, mother's or spouse's name", dob: "Date of birth", gender: "Gender", phone: "Phone", address: "Address", aadhaarLast4: "Aadhaar, last 4 digits" };

/** HR adds the NDA details a candidate did not give (older submissions did not ask for them). The offer letter fills in on its next open. */
function NdaDetails({ c, o }: { c: Candidate; o: Onb }) {
  const qc = useQueryClient();
  const p = (o.submission?.personal ?? {}) as Record<string, string | undefined>;
  const [f, setF] = useState({ relationName: p.relationName ?? "", aadhaarLast4: p.aadhaarLast4 ?? "", address: p.address ?? "", dob: p.dob ?? "" });
  const missing = ["relationName", "aadhaarLast4", "address", "dob"].filter((k) => !String(p[k] ?? "").trim());
  const [open, setOpen] = useState(false);
  const save = useMutation({
    mutationFn: () => api(`/candidates/${c.id}/onboarding/${o.id}/details`, { method: "PATCH", body: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() || undefined])) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["onb", c.id] }); setOpen(false); },
  });
  if (!missing.length && !open) return <p className="k" style={{ margin: "6px 0" }}>NDA details are complete. <button type="button" className="btn" onClick={() => setOpen(true)}>Correct them</button></p>;
  if (!open) return <div className="note warn" style={{ margin: "8px 0" }}>The NDA in the offer letter is missing: {missing.map((k) => PERSONAL_LABEL[k].toLowerCase()).join(", ")}. <button type="button" className="btn" onClick={() => setOpen(true)}>Add them</button></div>;
  return (
    <form style={{ margin: "8px 0" }} onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <p className="k">Printed in the NDA (Annexure A of the full offer letter). The letter picks these up the next time it is opened; it does not need to be issued again.</p>
      <div className="grid">
        <Field label={PERSONAL_LABEL.relationName}><input minLength={2} maxLength={120} value={f.relationName} onChange={(e) => setF({ ...f, relationName: e.target.value })} /></Field>
        <Field label={PERSONAL_LABEL.aadhaarLast4}><input inputMode="numeric" pattern="\d{4}" maxLength={4} value={f.aadhaarLast4} onChange={(e) => setF({ ...f, aadhaarLast4: e.target.value.replace(/\D/g, "").slice(0, 4) })} /></Field>
        <Field label={PERSONAL_LABEL.dob}><input type="date" value={f.dob} onChange={(e) => setF({ ...f, dob: e.target.value })} /></Field>
        <Field label={PERSONAL_LABEL.address}><textarea rows={2} maxLength={500} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
      </div>
      <ErrorNote error={save.error} />
      <p><button className="btn p" disabled={save.isPending}>Save NDA details</button> <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button></p>
    </form>
  );
}

function Onboarding({ c }: { c: Candidate }) {
  const qc = useQueryClient();
  const [steps, setSteps] = useState<string[]>(["details", "kyc", "bank", "documents"]);
  const [shared, setShared] = useState<Shared | null>(null);
  const subs = useQuery({ queryKey: ["onb", c.id], queryFn: () => api<Onb[]>(`/candidates/${c.id}/onboarding`) });
  // The default checklist from Configuration decides which steps start ticked; each new link keeps its own copy.
  const def = useQuery({ queryKey: ["config-onboarding"], queryFn: () => api<{ current: { version: number; items: ChecklistItem[] } }>("/config/onboarding") });
  useEffect(() => { if (def.data) setSteps(candidateSteps(def.data.current)); }, [def.data]);
  const tick = useMutation({ mutationFn: (x: { link: string; item: string; done: boolean }) => api(`/onboarding-links/${x.link}/checklist/${x.item}`, { method: "PATCH", body: { done: x.done } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["onb", c.id] }) });
  const create = useMutation({ mutationFn: () => api<Shared>(`/candidates/${c.id}/onboarding-link`, { body: { steps } }), onSuccess: (s) => { setShared(s); qc.invalidateQueries({ queryKey: ["onb", c.id] }); } });
  return (
    <Card><h2>Onboarding</h2>
      <p className="k">The candidate opens one link, verifies their email with a code, then completes the steps you tick.</p>
      <label className="ck" style={{ display: "flex", gap: 12, padding: "10px 0" }}><input type="checkbox" checked disabled /><span><strong>Verify email with a one-time code</strong><br /><span className="k">Always on</span></span></label>
      {STEPS.map((s) => <label key={s.key} style={{ display: "flex", gap: 12, padding: "10px 0", borderTop: "1px solid var(--line)", alignItems: "flex-start" }}>
        <input type="checkbox" checked={steps.includes(s.key)} onChange={(e) => setSteps(e.target.checked ? [...steps, s.key] : steps.filter((x) => x !== s.key))} />
        <span><strong>{s.label}</strong><br /><span className="k">{s.hint}</span></span></label>)}
      {def.data && <p className="k">The link copies the default onboarding checklist (version {def.data.current.version || "starting list"}, {def.data.current.items.length} items). <Link href="/admin/config?tab=onboarding">Edit it in Configuration → Onboarding</Link>.</p>}
      <ErrorNote error={create.error ?? tick.error} />
      <p><button className="btn p" disabled={create.isPending || !steps.length} onClick={() => create.mutate()}>Create onboarding link</button></p>
      {shared && <CopyLink shared={shared} title="Onboarding link created" />}
      {(subs.data ?? []).map((o) => <div key={o.id} style={{ borderTop: "1px solid var(--line)", paddingTop: 10, marginTop: 10 }}>
        <p style={{ margin: 0 }}><Chip tone={o.completedAt ? "ok" : "warn"}>{o.completedAt ? "Submitted" : "Waiting"}</Chip> <span className="k">Link created {o.createdAt.slice(0, 10)}, expires {o.expiresAt.slice(0, 10)}, steps: {o.steps.join(", ")}</span></p>
        {o.checklist && <div className="onb-checklist"><p className="k" style={{ margin: "8px 0 4px" }}>HR checklist (version {o.checklist.version})</p>
          {o.checklist.items.filter((i) => i.kind !== "candidate_step").map((i) => <label key={i.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "4px 0", fontSize: 14 }}>
            <input type="checkbox" checked={i.done} disabled={tick.isPending} onChange={(e) => tick.mutate({ link: o.id, item: i.id, done: e.target.checked })} />
            <span>{i.label}{!i.required && <span className="k"> (optional)</span>} <span className="k">· {KIND_LABEL[i.kind]}{i.done && i.doneBy ? ` · done by ${i.doneBy}` : ""}</span></span></label>)}</div>}
        {o.submission && <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "4px 16px", fontSize: 14 }}>
          {Object.entries(o.submission.personal ?? {}).map(([k, v]) => <><dt className="k" key={k + "k"}>{PERSONAL_LABEL[k] ?? k}</dt><dd key={k} style={{ margin: 0 }}>{String(v)}</dd></>)}
          {o.submission.panMasked && <><dt className="k">PAN</dt><dd style={{ margin: 0 }}>{o.submission.panMasked}</dd></>}
          {o.submission.bankName && <><dt className="k">Bank</dt><dd style={{ margin: 0 }}>{o.submission.bankName}, IFSC {o.submission.ifsc}, account {o.submission.accountMasked}</dd></>}
          <dt className="k">Documents</dt><dd style={{ margin: 0 }}>{o.submission.documents.length ? o.submission.documents.map((d) => `${d.kind === "bank_proof" ? "bank proof" : d.kind}: ${d.name}`).join("; ") : "None"}</dd>
        </dl>}
        {o.submission && o.completedAt && <NdaDetails key={o.submission.submittedAt ?? o.id} c={c} o={o} />}
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

type Pipeline = { stages: string[]; pipeline: { id: string; name: string; position: string | null; expectedJoining: string | null; stage: string }[];
  newJoiners: { id: string; name: string; code: string; joiningDate: string; steps: Record<string, boolean>; done: number; total: number }[] };
const STEP_LABEL: Record<string, [string, string]> = { profile: ["Profile completed", "/people"], manager: ["Manager set", "/people"], salary: ["Salary set", "/payroll"], appointment: ["Appointment letter issued", "/letters"],
  asset: ["Laptop or asset handed over", "/assets"], policies: ["Policies acknowledged", "/policies"], privacy: ["Privacy choices made", "/people"] };

function PipelineBoard({ onOpen }: { onOpen: (id: string) => void }) {
  const q = useQuery({ queryKey: ["pipeline"], queryFn: () => api<Pipeline>("/hiring/pipeline") });
  if (q.error) return <ErrorNote error={q.error} />;
  if (!q.data) return <Card><p>Loading…</p></Card>;
  const d = q.data;
  return <>
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${d.stages.length}, minmax(150px, 1fr))`, gap: 10, overflowX: "auto", paddingBottom: 8, marginBottom: 16 }}>
      {d.stages.map((st) => { const items = d.pipeline.filter((x) => x.stage === st); return <div key={st} style={{ background: "var(--ch-grid)", borderRadius: 14, padding: 10, minHeight: 160 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, marginBottom: 8 }}><span>{st}</span><span className="k">{items.length}</span></div>
        {items.map((x) => <button key={x.id} onClick={() => onOpen(x.id)} className="card" style={{ display: "block", width: "100%", textAlign: "left", font: "inherit", padding: 10, marginBottom: 8, cursor: "pointer" }}>
          <b style={{ fontSize: 13 }}>{x.name}</b><div className="k">{x.position ?? "No position"}{x.expectedJoining ? ` · joins ${x.expectedJoining}` : ""}</div></button>)}
      </div>; })}
    </div>
    <Card><h2>New joiners, first 45 days</h2><p className="k">What is still open for each person who joined recently. Click a step to go where it is done.</p>
      <DataTable rows={d.newJoiners} rowKey={(x) => x.id} file="new-joiners" initialSort={{ key: "joined", dir: -1 }} empty="Nobody has joined in the last 45 days."
        cols={[{ key: "name", label: "Name", value: (x) => x.name, render: (x) => <Link href={`/people/${x.id}`}>{x.name}</Link> }, { key: "code", label: "Code", value: (x) => x.code },
          { key: "joined", label: "Joined", value: (x) => x.joiningDate }, { key: "done", label: "Done", value: (x) => x.done, render: (x) => <Chip tone={x.done === x.total ? "ok" : "warn"}>{x.done} of {x.total}</Chip> },
          { key: "open", label: "Still open", value: (x) => Object.entries(x.steps).filter(([, v]) => !v).map(([k]) => STEP_LABEL[k][0]).join(", "),
            render: (x) => <div className="row-gap">{Object.entries(x.steps).filter(([, v]) => !v).map(([k]) => <Link key={k} href={STEP_LABEL[k][1]} className="chip warn" style={{ textDecoration: "none" }}>{STEP_LABEL[k][0]}</Link>)}</div> }]} /></Card>
  </>;
}

export default function Hiring() {
  const qc = useQueryClient();
  const [sel, setSel] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState("pipeline");
  const list = useQuery({ queryKey: ["candidates"], queryFn: () => api<Candidate[]>("/candidates") });
  const c = (list.data ?? []).find((x) => x.id === sel);
  const select = (id: string) => { setSel(id); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const open = (id: string) => { select(id); setTab("candidates"); };
  return (
    <Page title="Hiring and onboarding" actions={<button className="btn p" onClick={() => setAdding(!adding)}>{adding ? "Close" : "Add candidate"}</button>}>
      <ErrorNote error={list.error} />
      {adding && <AddCandidate onDone={() => { setAdding(false); qc.invalidateQueries({ queryKey: ["candidates"] }); qc.invalidateQueries({ queryKey: ["pipeline"] }); }} />}
      <div className="tabs" role="tablist">{[["pipeline", "Pipeline"], ["candidates", "Candidates"]].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => { setTab(k); setSel(null); }}>{l}</button>)}</div>
      {tab === "pipeline" && <PipelineBoard onOpen={open} />}
      {tab === "candidates" && c && <><div className="row-gap" style={{ alignItems: "center", margin: "4px 0 8px" }}><button className="btn" onClick={() => setSel(null)}>← All candidates</button><h2 style={{ margin: 0 }}>{c.fullName}</h2><Chip tone={tone(c.status)}>{c.status}</Chip><span className="k">{[c.position, c.email].filter(Boolean).join(" · ")}</span></div>
        <Letters key={"l" + c.id} c={c} /><ConsentChoices key={"cc" + c.id} c={c} /><Onboarding key={"o" + c.id} c={c} /><Convert key={"c" + c.id} c={c} onDone={() => qc.invalidateQueries({ queryKey: ["candidates"] })} /></>}
      {tab === "candidates" && !c && <><Card>
        <DataTable rows={list.data ?? []} rowKey={(x) => x.id} file="candidates" initialSort={{ key: "joining", dir: -1 }} empty="No candidates yet." onRow={(x) => select(x.id)}
          cols={[{ key: "name", label: "Name", value: (x) => x.fullName, render: (x) => <>{x.fullName}<br /><span className="k">{x.email}</span></> }, { key: "pos", label: "Position", value: (x) => x.position ?? null, filter: true },
            { key: "joining", label: "Expected joining", value: (x) => x.expectedJoining ?? null }, { key: "status", label: "Status", value: (x) => x.status, filter: true, render: (x) => <Chip tone={tone(x.status)}>{x.status}</Chip> },
            { key: "act", label: "", value: () => null, render: (x) => <button className="btn" onClick={(e) => { e.stopPropagation(); select(x.id); }}>Open</button> }]} />
      </Card></>}
    </Page>
  );
}
