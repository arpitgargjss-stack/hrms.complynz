import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Card, Chip, ErrorNote, Field, Page } from "../lib/ui";

type Me = { email: string; employeeId: string | null; roles: string[] };
type Item = { key: string; label: string; done: boolean; note?: string | null; doneBy?: string | null };
type Resign = { id: string; employeeId: string; code: string; employeeName: string; noticeDays: number | null; proposedLastDay: string; agreedLastDay: string | null; reason: string; comments: string | null; status: string; managerNote: string | null; checklist: Item[] | null; createdAt: string };
type Goal = { goal: string; measure: string; due: string; status: string; progressNote: string | null };
type Checkpoint = { date: string; note: string | null; notedBy: string | null };
type Pip = { id: string; employeeId: string; code: string; employeeName: string; startDate: string; lengthDays: number; concerns: string; goals: Goal[]; support: string | null; checkpoints: Checkpoint[] | null; status: string; outcome: string | null; acknowledgedAt: string | null; employeeResponse: string | null };

const tone = (s: string) => (s === "accepted" || s === "completed" || s === "active" ? "ok" : s === "submitted" || s === "manager_reviewed" || s === "extended" ? "warn" : s === "withdrawn" || s === "closed" ? "mute" : "info") as "ok" | "warn" | "mute" | "info";
const label = (s: string) => s.replace(/_/g, " ");
const STAGES = ["submitted", "manager_reviewed", "accepted", "completed"];

function Progress({ r }: { r: Resign }) {
  const at = STAGES.indexOf(r.status);
  return <ol style={{ display: "flex", flexWrap: "wrap", gap: 8, listStyle: "none", padding: 0, margin: "8px 0" }}>
    {STAGES.map((s, i) => <li key={s}><Chip tone={i <= at ? "ok" : "mute"}>{i + 1}. {label(s)}</Chip></li>)}</ol>;
}

function Checklist({ r, edit }: { r: Resign; edit: boolean }) {
  const qc = useQueryClient();
  const m = useMutation({ mutationFn: (a: { key: string; done: boolean }) => api(`/resignations/${r.id}/checklist`, { method: "PATCH", body: a }), onSuccess: () => qc.invalidateQueries({ queryKey: ["resignations"] }) });
  const list = r.checklist ?? [];
  if (!list.length) return null;
  return <div><h2>Exit checklist</h2><ErrorNote error={m.error} />
    {list.map((i) => <label key={i.key} style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 44 }}>
      <input type="checkbox" checked={i.done} disabled={!edit || m.isPending} onChange={(e) => m.mutate({ key: i.key, done: e.target.checked })} /><span>{i.label}{i.done && i.doneBy ? <span className="k"> · {i.doneBy}</span> : null}</span></label>)}</div>;
}

function MyResignation({ me }: { me: Me }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["resignations"], queryFn: () => api<Resign[]>("/resignations") });
  const mine = (q.data ?? []).filter((r) => r.employeeId === me.employeeId);
  const active = mine.find((r) => ["submitted", "manager_reviewed", "accepted"].includes(r.status));
  const [f, setF] = useState({ proposedLastDay: "", reason: "", comments: "" });
  const submit = useMutation({ mutationFn: () => api("/resignations", { body: { proposedLastDay: f.proposedLastDay, reason: f.reason, comments: f.comments || undefined } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["resignations"] }) });
  const withdraw = useMutation({ mutationFn: (id: string) => api(`/resignations/${id}/withdraw`, { method: "POST", body: {} }), onSuccess: () => qc.invalidateQueries({ queryKey: ["resignations"] }) });
  return (
    <>
      <ErrorNote error={q.error} />
      {active ? <Card><h2>My resignation</h2><Chip tone={tone(active.status)}>{label(active.status)}</Chip><Progress r={active} />
        <p>Proposed last day {active.proposedLastDay}{active.agreedLastDay ? `; agreed last day ${active.agreedLastDay}` : ""}. Reason: {active.reason}</p>
        {active.managerNote && <p className="k">Manager note: {active.managerNote}</p>}
        <Checklist r={active} edit={false} />
        <ErrorNote error={withdraw.error} />
        {["submitted", "manager_reviewed"].includes(active.status) && <p><button className="btn" disabled={withdraw.isPending} onClick={() => window.confirm("Withdraw your resignation?") && withdraw.mutate(active.id)}>Withdraw resignation</button></p>}
      </Card> : <Card><h2>Submit resignation</h2>
        <p className="k">Your manager reviews it and HR then accepts it and agrees a last working day. You can withdraw until it is accepted.</p>
        <form onSubmit={(e) => { e.preventDefault(); if (window.confirm("Submit your resignation?")) submit.mutate(); }}>
          <Field label="Proposed last working day"><input type="date" required value={f.proposedLastDay} onChange={(e) => setF({ ...f, proposedLastDay: e.target.value })} /></Field>
          <Field label="Reason"><input required minLength={2} maxLength={100} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
          <Field label="Comments (optional)"><textarea rows={4} maxLength={2000} value={f.comments} onChange={(e) => setF({ ...f, comments: e.target.value })} /></Field>
          <ErrorNote error={submit.error} />
          <p><button className="btn p" disabled={submit.isPending}>Submit resignation</button></p>
        </form></Card>}
      {mine.filter((r) => r !== active).length > 0 && <Card><h2>Earlier</h2>{mine.filter((r) => r !== active).map((r) => <p key={r.id}>{r.createdAt.slice(0, 10)}: <Chip tone={tone(r.status)}>{label(r.status)}</Chip></p>)}</Card>}
    </>
  );
}

function MyPip({ me }: { me: Me }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["pips"], queryFn: () => api<Pip[]>("/pips") });
  const mine = (q.data ?? []).filter((p) => p.employeeId === me.employeeId);
  const [resp, setResp] = useState<Record<string, string>>({});
  const ack = useMutation({ mutationFn: (id: string) => api(`/pips/${id}/acknowledge`, { method: "POST", body: {} }), onSuccess: () => qc.invalidateQueries({ queryKey: ["pips"] }) });
  const save = useMutation({ mutationFn: (id: string) => api(`/pips/${id}/response`, { method: "PUT", body: { text: resp[id] } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["pips"] }) });
  if (!mine.length) return null;
  return <>{mine.map((p) => <Card key={p.id}><h2>My performance plan <Chip tone={tone(p.status)}>{label(p.status)}</Chip></h2>
    <p className="k">{p.startDate}, {p.lengthDays} days</p><p>{p.concerns}</p>
    <ol>{p.goals.map((g, i) => <li key={i}><strong>{g.goal}</strong><br /><span className="k">Measure: {g.measure} · due {g.due} · {label(g.status)}{g.progressNote ? ` · ${g.progressNote}` : ""}</span></li>)}</ol>
    {p.support && <p>Support: {p.support}</p>}
    {(p.checkpoints ?? []).length > 0 && <p className="k">Checkpoints: {(p.checkpoints ?? []).map((c) => c.date + (c.note ? ` (${c.note})` : "")).join("; ")}</p>}
    {p.outcome && <p>Outcome: {p.outcome}</p>}
    <ErrorNote error={ack.error || save.error} />
    {p.acknowledgedAt ? <p><Chip tone="ok">Receipt acknowledged {p.acknowledgedAt.slice(0, 10)}</Chip></p>
      : <p><button className="btn p" disabled={ack.isPending} onClick={() => ack.mutate(p.id)}>Acknowledge receipt</button><br /><span className="k">Acknowledging confirms you received this plan, not that you agree with it.</span></p>}
    {["active", "extended"].includes(p.status) && <><Field label="My response"><textarea rows={4} maxLength={5000} value={resp[p.id] ?? p.employeeResponse ?? ""} onChange={(e) => setResp({ ...resp, [p.id]: e.target.value })} /></Field>
      <p><button className="btn" disabled={save.isPending || !(resp[p.id] ?? "").trim()} onClick={() => save.mutate(p.id)}>Save response</button></p></>}
  </Card>)}</>;
}

function Resignations({ hr, me }: { hr: boolean; me: Me }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["resignations"], queryFn: () => api<Resign[]>("/resignations") });
  const [text, setText] = useState<Record<string, string>>({});
  const refresh = () => qc.invalidateQueries({ queryKey: ["resignations"] });
  const review = useMutation({ mutationFn: (id: string) => api(`/resignations/${id}/manager-review`, { body: { note: text["n" + id] } }), onSuccess: refresh });
  const accept = useMutation({ mutationFn: (a: { id: string; day: string }) => api(`/resignations/${a.id}/accept`, { body: { agreedLastDay: a.day } }), onSuccess: refresh });
  const complete = useMutation({ mutationFn: (a: { id: string; override: boolean }) => api(`/resignations/${a.id}/complete`, { body: { overrideChecklist: a.override || undefined } }), onSuccess: refresh });
  const rows = (q.data ?? []).filter((r) => r.employeeId !== me.employeeId);
  return (
    <>
      <ErrorNote error={q.error || review.error || accept.error || complete.error} />
      {rows.length === 0 && <Card><p>No resignations to show.</p></Card>}
      {rows.map((r) => {
        const open = (r.checklist ?? []).filter((i) => !i.done).length;
        return <Card key={r.id}><h2>{r.employeeName} <span className="k">{r.code}</span> <Chip tone={tone(r.status)}>{label(r.status)}</Chip></h2>
          <Progress r={r} />
          <p>Proposed last day {r.proposedLastDay}{r.agreedLastDay ? `, agreed ${r.agreedLastDay}` : ""}. Reason: {r.reason}{r.comments ? `. ${r.comments}` : ""}</p>
          {r.managerNote && <p className="k">Manager note: {r.managerNote}</p>}
          {["submitted", "manager_reviewed"].includes(r.status) && <>
            <Field label="Manager note"><textarea rows={2} maxLength={2000} value={text["n" + r.id] ?? ""} onChange={(e) => setText({ ...text, ["n" + r.id]: e.target.value })} /></Field>
            <p><button className="btn" disabled={review.isPending || !(text["n" + r.id] ?? "").trim()} onClick={() => review.mutate(r.id)}>Save manager review</button> <span className="k">Only the employee's manager can review.</span></p>
            {hr && <div className="row-gap" style={{ alignItems: "end" }}><Field label="Agreed last working day"><input type="date" value={text["d" + r.id] ?? r.proposedLastDay} onChange={(e) => setText({ ...text, ["d" + r.id]: e.target.value })} /></Field>
              <button className="btn p" disabled={accept.isPending} onClick={() => window.confirm(`Accept the resignation of ${r.employeeName}?`) && accept.mutate({ id: r.id, day: text["d" + r.id] ?? r.proposedLastDay })}>Accept resignation</button></div>}</>}
          {r.status === "accepted" && <><Checklist r={r} edit={hr} />
            {hr && <p><button className="btn p" disabled={complete.isPending} onClick={() => {
              if (open && !window.confirm(`${open} checklist item(s) are open. Complete the exit anyway?`)) return;
              if (window.confirm(`Complete the exit of ${r.employeeName}? This marks them as exited.`)) complete.mutate({ id: r.id, override: open > 0 });
            }}>Complete exit</button><br /><span className="k">Only possible after the last working day has passed.</span></p>}</>}
        </Card>;
      })}
    </>
  );
}

function IssuePip() {
  const qc = useQueryClient();
  const emps = useQuery({ queryKey: ["employeesLite"], queryFn: () => api<{ employees: { id: string; code: string; fullName: string; status?: string }[] }>("/employees") });
  const blank = { employeeId: "", startDate: "", lengthDays: "30", concerns: "", support: "", checkpoints: ["", ""], goals: [0, 1, 2].map(() => ({ goal: "", measure: "", due: "" })) };
  const [f, setF] = useState(blank);
  const m = useMutation({
    mutationFn: () => api("/pips", { body: { employeeId: f.employeeId, startDate: f.startDate, lengthDays: Number(f.lengthDays), concerns: f.concerns, support: f.support || undefined, goals: f.goals, checkpoints: f.checkpoints.filter(Boolean) } }),
    onSuccess: () => { setF(blank); qc.invalidateQueries({ queryKey: ["pips"] }); },
  });
  const setGoal = (i: number, k: "goal" | "measure" | "due", v: string) => setF({ ...f, goals: f.goals.map((g, j) => (j === i ? { ...g, [k]: v } : g)) });
  return (
    <Card><h2>Issue a performance plan</h2>
      <p className="k">Records the plan and its outcome only. Any decision about employment is made outside this system.</p>
      <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <div className="grid">
          <Field label="Employee"><select required value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}><option value="">Select…</option>{(emps.data?.employees ?? []).filter((x) => x.status !== "exited").map((x) => <option key={x.id} value={x.id}>{x.fullName} ({x.code})</option>)}</select></Field>
          <Field label="Start date"><input type="date" required value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label="Length"><select value={f.lengthDays} onChange={(e) => setF({ ...f, lengthDays: e.target.value })}><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option></select></Field>
        </div>
        <Field label="Concerns"><textarea required minLength={5} rows={3} maxLength={4000} value={f.concerns} onChange={(e) => setF({ ...f, concerns: e.target.value })} /></Field>
        {f.goals.map((g, i) => <fieldset key={i} style={{ border: "1px solid var(--line)", borderRadius: 8, margin: "12px 0 0" }}><legend className="k">Goal {i + 1}</legend>
          <Field label="Goal"><input required minLength={2} value={g.goal} onChange={(e) => setGoal(i, "goal", e.target.value)} /></Field>
          <Field label="How it is measured"><input required minLength={2} value={g.measure} onChange={(e) => setGoal(i, "measure", e.target.value)} /></Field>
          <Field label="Due date"><input type="date" required value={g.due} onChange={(e) => setGoal(i, "due", e.target.value)} /></Field></fieldset>)}
        <Field label="Support offered (optional)"><textarea rows={2} maxLength={2000} value={f.support} onChange={(e) => setF({ ...f, support: e.target.value })} /></Field>
        {f.checkpoints.map((c, i) => <Field key={i} label={`Checkpoint ${i + 1} date (optional)`}><input type="date" value={c} onChange={(e) => setF({ ...f, checkpoints: f.checkpoints.map((x, j) => (j === i ? e.target.value : x)) })} /></Field>)}
        <ErrorNote error={m.error} />{m.isSuccess && <div className="note ok" role="status">Plan issued.</div>}
        <p><button className="btn p" disabled={m.isPending}>Issue plan</button></p>
      </form>
    </Card>
  );
}

function PipManage({ hr, me }: { hr: boolean; me: Me }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["pips"], queryFn: () => api<Pip[]>("/pips") });
  const [t, setT] = useState<Record<string, string>>({});
  const refresh = () => qc.invalidateQueries({ queryKey: ["pips"] });
  const goal = useMutation({ mutationFn: (a: { id: string; i: number; status: string }) => api(`/pips/${a.id}/goals/${a.i}`, { method: "PATCH", body: { status: a.status, progressNote: t[`g${a.id}${a.i}`]?.trim() || undefined } }), onSuccess: refresh });
  const cp = useMutation({ mutationFn: (a: { id: string; i: number }) => api(`/pips/${a.id}/checkpoints/${a.i}`, { method: "PATCH", body: { note: t[`c${a.id}${a.i}`] } }), onSuccess: refresh });
  const close = useMutation({ mutationFn: (a: { id: string; outcome: string }) => api(`/pips/${a.id}/close`, { body: { outcome: a.outcome, note: t["o" + a.id]?.trim() || undefined } }), onSuccess: refresh });
  const rows = (q.data ?? []).filter((p) => p.employeeId !== me.employeeId);
  return (
    <>
      {hr && <IssuePip />}
      <ErrorNote error={q.error || goal.error || cp.error || close.error} />
      {rows.map((p) => { const open = ["active", "extended"].includes(p.status); return <Card key={p.id}>
        <h2>{p.employeeName} <span className="k">{p.code}</span> <Chip tone={tone(p.status)}>{label(p.status)}</Chip></h2>
        <p className="k">{p.startDate}, {p.lengthDays} days · {p.acknowledgedAt ? `receipt acknowledged ${p.acknowledgedAt.slice(0, 10)}` : "not yet acknowledged"}</p>
        <p>{p.concerns}</p>
        {p.goals.map((g, i) => <div key={i} style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}><strong>{g.goal}</strong> <span className="k">({g.measure}, due {g.due})</span> <Chip tone={g.status === "met" ? "ok" : g.status === "at_risk" || g.status === "not_met" ? "bad" : "info"}>{label(g.status)}</Chip>
          {g.progressNote && <div className="k">{g.progressNote}</div>}
          {open && <div className="row-gap" style={{ alignItems: "end" }}><Field label="Progress note"><input value={t[`g${p.id}${i}`] ?? ""} onChange={(e) => setT({ ...t, [`g${p.id}${i}`]: e.target.value })} /></Field>
            <Field label="Status"><select value={g.status} onChange={(e) => goal.mutate({ id: p.id, i, status: e.target.value })}>{["open", "on_track", "at_risk", "met", "not_met"].map((s) => <option key={s} value={s}>{label(s)}</option>)}</select></Field></div>}</div>)}
        {(p.checkpoints ?? []).map((c, i) => <div key={i} style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>Checkpoint {c.date}: {c.note ?? <span className="k">no note yet</span>}
          {open && <div className="row-gap" style={{ alignItems: "end" }}><Field label="Checkpoint note"><input value={t[`c${p.id}${i}`] ?? ""} onChange={(e) => setT({ ...t, [`c${p.id}${i}`]: e.target.value })} /></Field>
            <button className="btn" disabled={cp.isPending || !(t[`c${p.id}${i}`] ?? "").trim()} onClick={() => cp.mutate({ id: p.id, i })}>Save note</button></div>}</div>)}
        {p.employeeResponse && <p><strong>Employee response:</strong> {p.employeeResponse}</p>}
        {p.outcome && <p>Outcome: {p.outcome}</p>}
        {hr && open && <div style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}><Field label="Closing note (optional)"><input value={t["o" + p.id] ?? ""} onChange={(e) => setT({ ...t, ["o" + p.id]: e.target.value })} /></Field>
          <p className="row-gap">{[["met", "Close: met"], ["extended", "Extend"], ["not_met", "Close: not met"], ["withdrawn", "Withdraw plan"]].map(([o, l]) => <button key={o} className="btn" disabled={close.isPending} onClick={() => window.confirm(`${l}? This records the outcome only.`) && close.mutate({ id: p.id, outcome: o })}>{l}</button>)}</p></div>}
      </Card>; })}
      {!rows.length && <Card><p>No performance plans to show.</p></Card>}
    </>
  );
}

export default function Exits() {
  const meQ = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
  const me = meQ.data;
  const [tab, setTab] = useState("mine");
  if (!me) return <Page title="Resignation and PIPs"><ErrorNote error={meQ.error} />Loading…</Page>;
  const hr = me.roles.includes("hr_admin"), mgr = me.roles.includes("manager");
  const tabs = [{ k: "mine", l: "Mine" }, ...(hr || mgr ? [{ k: "res", l: hr ? "Resignations" : "My reports' resignations" }, { k: "pip", l: hr ? "Performance plans" : "My reports' plans" }] : [])];
  return (
    <Page title="Resignation and PIPs">
      <div className="tabs" role="tablist">{tabs.map((t) => <button key={t.k} role="tab" aria-selected={tab === t.k} className={tab === t.k ? "on" : ""} onClick={() => setTab(t.k)}>{t.l}</button>)}</div>
      {tab === "mine" && <><MyResignation me={me} /><MyPip me={me} /></>}
      {tab === "res" && <Resignations hr={hr} me={me} />}
      {tab === "pip" && <PipManage hr={hr} me={me} />}
    </Page>
  );
}
