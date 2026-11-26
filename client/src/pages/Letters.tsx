import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, apiText } from "../lib/api";
import { openHtml } from "../lib/openHtml";
import { Card, Chip, ErrorNote, Field, Page } from "../lib/ui";
import { DataTable, type Col } from "../lib/DataTable";
import { COMPANY_DEFAULTS, LETTER_DEFS, LETTER_STATUS_LABEL, letterDef, letterLabel, type CompanyProfile, type LetterDef } from "../../../shared/hr/letters";
import { TEMPLATE_PRESETS } from "../../../shared/hr/presets";

type Me = { roles: string[] };
type Letter = { id: string; type: string; refNo: string; status: string; createdAt: string; issuedAt: string | null; approvedAt: string | null; reviewNote: string | null; submittedBy: string | null; createdBy: string | null; recipient: string; recipientCode: string | null; recipientKind: string; candidateId: string | null };
type Person = { id: string; label: string; kind: "employee" | "candidate" };
const tone = (s: string) => (s === "issued" || s === "accepted" ? "ok" : s === "approved" ? "info" : s === "pending_approval" ? "warn" : s === "void" ? "bad" : "mute") as "ok" | "info" | "warn" | "bad" | "mute";
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "-");

function Actions({ l, ceo, onDone }: { l: Letter; ceo: boolean; onDone: () => void }) {
  const [err, setErr] = useState<unknown>(null);
  const act = useMutation({ mutationFn: (a: { path: string; body?: unknown }) => api(`/letters/${l.id}/${a.path}`, { method: "POST", body: a.body ?? {} }), onSuccess: onDone, onError: setErr });
  const go = (path: string, body?: unknown) => { setErr(null); act.mutate({ path, body }); };
  return <div className="row-gap" onClick={(e) => e.stopPropagation()}>
    <button className="btn" onClick={() => openHtml(`/letters/${l.id}/html`)}>Open</button>
    {l.status === "draft" && !ceo && <button className="btn p" disabled={act.isPending} onClick={() => go("submit")}>Send to CEO</button>}
    {ceo && (l.status === "draft" || l.status === "pending_approval") && <button className="btn p" disabled={act.isPending} onClick={() => go("approve")}>Approve</button>}
    {ceo && l.status === "pending_approval" && <button className="btn" disabled={act.isPending} onClick={() => { const note = window.prompt("What should change?"); if (note) go("reject", { note }); }}>Send back</button>}
    {l.status === "approved" && <button className="btn p" disabled={act.isPending} onClick={() => go("issue")}>Issue</button>}
    {l.status === "issued" && l.candidateId && (l.type === "offer_short" || l.type === "offer_full") && <Link className="btn" href="/hiring">Share link in Hiring</Link>}
    {["draft", "pending_approval", "approved"].includes(l.status) && <button className="btn" disabled={act.isPending} onClick={() => window.confirm("Withdraw this letter?") && go("void")}>Withdraw</button>}
    <ErrorNote error={err} />
  </div>;
}

function AllLetters({ ceo, onlyPending = false }: { ceo: boolean; onlyPending?: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["letters-all"], queryFn: () => api<Letter[]>("/letters") });
  const rows = (q.data ?? []).filter((l) => !onlyPending || l.status === "pending_approval" || (ceo && l.status === "draft" && false));
  const cols: Col<Letter>[] = [
    { key: "ref", label: "Reference", value: (l) => l.refNo },
    { key: "type", label: "Letter", value: (l) => letterLabel(l.type), filter: true },
    { key: "to", label: "To", value: (l) => l.recipient, render: (l) => <>{l.recipient}<div className="k">{l.recipientKind === "candidate" ? "Candidate" : l.recipientCode}</div></> },
    { key: "group", label: "Kind", value: (l) => letterDef(l.type)?.group ?? "Other", filter: true },
    { key: "status", label: "Status", value: (l) => LETTER_STATUS_LABEL[l.status] ?? l.status, filter: true, render: (l) => <><Chip tone={tone(l.status)}>{LETTER_STATUS_LABEL[l.status] ?? l.status}</Chip>{l.reviewNote && l.status === "draft" && <div className="k">CEO note: {l.reviewNote}</div>}</> },
    { key: "created", label: "Created", value: (l) => l.createdAt, render: (l) => day(l.createdAt) },
    { key: "issued", label: "Issued", value: (l) => l.issuedAt, render: (l) => day(l.issuedAt) },
    { key: "act", label: "", value: () => null, render: (l) => <Actions l={l} ceo={ceo} onDone={() => qc.invalidateQueries({ queryKey: ["letters-all"] })} /> },
  ];
  return <Card><ErrorNote error={q.error} />
    {onlyPending && <p className="k">Every letter is approved by the CEO before it can be issued. Open a letter to read it in full, then approve it or send it back with a note.</p>}
    <DataTable rows={rows} cols={cols} rowKey={(l) => l.id} file={onlyPending ? "letters-for-approval" : "letters"} initialSort={{ key: "created", dir: -1 }} empty={onlyPending ? "Nothing is waiting for approval." : "No letters yet. Write one from the next tab."} />
  </Card>;
}

/** Picks a current employee by name (stored as the name, as printed on the letter). Keeps an older typed value selectable. */
function EmployeePick({ v, set }: { v: string; set: (x: unknown) => void }) {
  const q = useQuery({ queryKey: ["letter-employees"], queryFn: () => api<{ id: string; code: string; fullName: string }[]>("/letters/employees"), staleTime: 60_000 });
  const names = (q.data ?? []).map((e) => e.fullName);
  return <select value={v} onChange={(e) => set(e.target.value || undefined)}><option value="">Choose</option>
    {v && !names.includes(v) && <option value={v}>{v}</option>}
    {(q.data ?? []).map((e) => <option key={e.id} value={e.fullName}>{e.fullName} ({e.code})</option>)}</select>;
}

export function FieldInput({ f, v, set }: { f: LetterDef["fields"][number]; v: unknown; set: (x: unknown) => void }) {
  const s = v == null ? "" : String(v);
  if (f.kind === "textarea") return <textarea rows={3} value={s} onChange={(e) => set(e.target.value)} />;
  if (f.kind === "date") return <input type="date" value={s} onChange={(e) => set(e.target.value || undefined)} />;
  if (f.kind === "number") return <input type="number" min={0} value={s} onChange={(e) => set(e.target.value === "" ? undefined : Number(e.target.value))} />;
  if (f.kind === "money") return <input inputMode="decimal" placeholder="0" value={typeof v === "number" ? String(v / 100) : ""} onChange={(e) => { const n = Number(e.target.value.replace(/[,₹\s]/g, "")); set(e.target.value === "" || !Number.isFinite(n) ? undefined : Math.round(n * 100)); }} />;
  if (f.kind === "bool") return <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={v === true} onChange={(e) => set(e.target.checked)} />Yes</label>;
  if (f.kind === "select") return <select value={s} onChange={(e) => set(e.target.value || undefined)}><option value="">Choose</option>{f.options!.map((o) => <option key={o}>{o}</option>)}</select>;
  if (f.kind === "employee") return <EmployeePick v={s} set={set} />;
  if (f.kind === "template") return <select value={s || "standard"} onChange={(e) => set(e.target.value)}>{TEMPLATE_PRESETS.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</select>;
  return <input value={s} onChange={(e) => set(e.target.value || undefined)} />;
}

function Write({ onSaved }: { onSaved: () => void }) {
  const [type, setType] = useState<string | null>(null);
  const def = type ? letterDef(type)! : null;
  const people = useQuery({ queryKey: ["letter-people"], queryFn: async () => {
    const [e, c] = await Promise.all([api<{ employees: { id: string; code: string; fullName: string }[] }>("/payroll/employees").then((r) => r.employees).catch(() => []), api<{ id: string; fullName: string; status: string }[]>("/candidates").catch(() => [])]);
    return [...e.map((x) => ({ id: x.id, label: `${x.fullName} (${x.code})`, kind: "employee" as const })), ...c.filter((x) => x.status !== "joined").map((x) => ({ id: x.id, label: `${x.fullName} (candidate)`, kind: "candidate" as const }))];
  } });
  const [who, setWho] = useState<Person | null>(null);
  const [name, setName] = useState("");
  const [p, setP] = useState<Record<string, unknown>>({});
  const [html, setHtml] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const choices = (people.data ?? []).filter((x) => !def || def.audience === "both" || def.audience === x.kind);

  useEffect(() => { if (!who || !def) return; (async () => {
    const r = await api<{ name: string; code?: string; from?: Record<string, unknown>; values?: Record<string, unknown>; resignationDate?: string }>(`/letters/prefill?${who.kind === "employee" ? "employeeId" : "candidateId"}=${who.id}`);
    setName(r.name);
    const next: Record<string, unknown> = { ...(r.values ?? {}) };
    for (const f of def.fields) if (f.fromEmployee && r.from?.[f.fromEmployee] != null) next[f.key] = r.from[f.fromEmployee];
    if (def.type === "relieving" && r.resignationDate) next.resignationDate = r.resignationDate;
    if (def.type === "offer_full") { next.templateKey ??= "standard"; next.employmentType ??= "Full-Time, Permanent"; }
    setP(next);
  })().catch(setErr); }, [who?.id, type]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!type) return; const t = setTimeout(() => { apiText("/letters/preview", { type, name, payload: p }).then(setHtml).catch(setErr); }, 350); return () => clearTimeout(t); }, [type, name, p]);

  const save = useMutation({ mutationFn: async (submit: boolean) => {
    const row = await api<{ id: string }>("/letters", { body: { type, payload: p, ...(who!.kind === "employee" ? { employeeId: who!.id } : { candidateId: who!.id }) } });
    if (submit) await api(`/letters/${row.id}/submit`, { method: "POST", body: {} });
  }, onSuccess: () => { setType(null); setWho(null); setP({}); onSaved(); } });

  if (!def) {
    const groups = [...new Set(LETTER_DEFS.map((d) => d.group))];
    return <>{groups.map((g) => <Card key={g}><h2>{g}</h2><div className="grid">{LETTER_DEFS.filter((d) => d.group === g && d.type !== "fnf_statement").map((d) =>
      <button key={d.type} className="card" style={{ textAlign: "left", cursor: "pointer", font: "inherit", marginBottom: 0 }} onClick={() => setType(d.type)}><b>{d.label}</b><div className="k" style={{ marginTop: 4 }}>{d.summary}</div></button>)}</div>
      {g === "Exit" && <p className="k">The full and final statement is created from a settlement in Resignation and PIPs.</p>}</Card>)}</>;
  }
  return <div style={{ display: "grid", gridTemplateColumns: "minmax(320px,420px) 1fr", gap: 16, alignItems: "start" }}>
    <Card><div className="row-gap" style={{ justifyContent: "space-between" }}><h2 style={{ margin: 0 }}>{def.label}</h2><button className="btn" onClick={() => { setType(null); setWho(null); setP({}); }}>Change</button></div>
      <Field label={def.audience === "candidate" ? "Candidate" : def.audience === "employee" ? "Employee" : "Person"}>
        <select value={who ? `${who.kind}:${who.id}` : ""} onChange={(e) => setWho(choices.find((x) => `${x.kind}:${x.id}` === e.target.value) ?? null)}>
          <option value="">Choose</option>{choices.map((x) => <option key={x.kind + x.id} value={`${x.kind}:${x.id}`}>{x.label}</option>)}</select></Field>
      {def.audience === "candidate" && <p className="k">Add the candidate in <Link href="/hiring">Hiring</Link> first if they are not listed.</p>}
      {def.fields.map((f) => <Field key={f.key} label={f.label}><FieldInput f={f} v={p[f.key]} set={(x) => setP({ ...p, [f.key]: x })} />{f.hint && <span className="k">{f.hint}</span>}</Field>)}
      <p className="k">Anything left blank shows as a highlighted placeholder. Every letter goes to the CEO for approval before it can be issued.</p>
      <ErrorNote error={save.error ?? err} />
      <div className="row-gap"><button className="btn p" disabled={!who || save.isPending} onClick={() => save.mutate(true)}>Save and send to CEO</button><button className="btn" disabled={!who || save.isPending} onClick={() => save.mutate(false)}>Save as draft</button></div>
    </Card>
    <Card><div className="k" style={{ marginBottom: 6 }}>Live preview</div><iframe title="Letter preview" srcDoc={html} style={{ width: "100%", height: "calc(100vh - 220px)", minHeight: 640, border: "1px solid var(--line)", borderRadius: 12, background: "#fff" }} /></Card>
  </div>;
}

const PROFILE_FIELDS: [keyof CompanyProfile, string][] = [["legalName", "Legal name"], ["brandName", "Name used in letters"], ["registeredAddress", "Registered office"], ["cin", "CIN"], ["website", "Website"], ["email", "Contact email"],
  ["signatoryName", "Signatory name"], ["signatoryDesignation", "Signatory designation"], ["grievanceOfficerName", "Grievance officer / DPO name"], ["grievanceOfficerEmail", "Grievance officer email"],
  ["courts", "Courts with jurisdiction (offer letter)"], ["arbitrationSeat", "Seat of arbitration (NDA)"], ["ndaDamages", "Liquidated damages per breach (NDA), e.g. 25,00,000 (Indian Rupees Twenty-Five Lakh only)"]];
export function Company({ ceo }: { ceo: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["letters-company"], queryFn: () => api<CompanyProfile>("/letters/company") });
  const [f, setF] = useState<CompanyProfile | null>(null);
  useEffect(() => { if (q.data) setF(q.data); }, [q.data]);
  const save = useMutation({ mutationFn: () => api("/letters/company", { method: "PUT", body: f }), onSuccess: () => qc.invalidateQueries({ queryKey: ["letters-company"] }) });
  if (!f) return <Card><p>Loading…</p></Card>;
  return <Card><h2>Printed on every letter</h2><p className="k">{ceo ? "Changes apply to letters opened from now on, including issued ones." : "Only the CEO can change these."}</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: "0 16px" }}>{PROFILE_FIELDS.map(([k, l]) => <Field key={k} label={l}><input disabled={!ceo} value={f[k] ?? ""} placeholder={COMPANY_DEFAULTS[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>)}</div>
    <ErrorNote error={save.error} />{ceo && <p><button className="btn p" disabled={save.isPending} onClick={() => save.mutate()}>{save.isSuccess ? "Saved" : "Save"}</button></p>}</Card>;
}

export default function Letters() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
  const ceo = !!me.data?.roles.includes("super_admin");
  const qc = useQueryClient();
  const all = useQuery({ queryKey: ["letters-all"], queryFn: () => api<Letter[]>("/letters") });
  const pending = useMemo(() => (all.data ?? []).filter((l) => l.status === "pending_approval").length, [all.data]);
  const [tab, setTab] = useState<string>("all");
  const tabs: [string, string][] = [["all", "All letters"], ["write", "Write a letter"], ["approve", `CEO approval${pending ? ` (${pending})` : ""}`], ["company", "Company details"]];
  return <Page title="Letters">
    <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
    {tab === "all" && <AllLetters ceo={ceo} />}
    {tab === "write" && <Write onSaved={() => { qc.invalidateQueries({ queryKey: ["letters-all"] }); setTab("all"); }} />}
    {tab === "approve" && <AllLetters ceo={ceo} onlyPending />}
    {tab === "company" && <Company ceo={ceo} />}
  </Page>;
}
