import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { openHtml } from "../lib/openHtml";
import { Card, Chip, ErrorNote, Field, Page } from "../lib/ui";
import { DataTable, type Col } from "../lib/DataTable";
import { Stat } from "../lib/charts";

type Facts = { headcount: number; interns: number; states: string[]; officeStates: string[]; extraStates: string[]; entity: "private_limited" | "llp" | "opc"; industry: string; turnoverBand: string; gstRegistered: boolean; dpiit: boolean; foreignInvestment: boolean; msme: boolean; msmeVendors: boolean; incorporatedOn: string | null };
type Item = { key: string; title: string; category: string; law: string; frequency: string; dueText: string; form: string | null; portal: string | null; template: string | null; need: string; why: string; status: string; due: string | null; period: string | null; last: { period: string; status: string; doneOn: string | null; note: string | null; by: string } | null };
type Resp = { today: string; facts: Facts; items: Item[]; options: { industries: string[]; turnoverBands: Record<string, string>; states: string[] } };
type Hist = { id: string; itemKey: string; title: string; period: string; status: string; doneOn: string | null; note: string | null; by: string; createdAt: string };

const CATEGORIES = ["HR and labour", "Payroll taxes", "Finance and tax", "Corporate (MCA)", "Foreign investment", "Startup and MSME", "Data protection and IT"];
const STATUS_ORDER = ["Overdue", "Due in 30 days", "To do", "Upcoming", "Ongoing", "On event", "Done", "Not applicable"];
const tone = (s: string) => (s === "Overdue" ? "bad" : s === "Due in 30 days" || s === "To do" ? "warn" : s === "Done" ? "ok" : s === "Upcoming" ? "info" : "mute") as "bad" | "warn" | "ok" | "info" | "mute";
const dd = (d: string | null) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");
const ENTITY: Record<Facts["entity"], string> = { private_limited: "Private limited company", llp: "LLP", opc: "One person company" };

function MarkDone({ it, onClose }: { it: Item; onClose: () => void }) {
  const qc = useQueryClient();
  const [doneOn, setDoneOn] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const m = useMutation({ mutationFn: (status: "done" | "na") => api(`/compliance/${it.key}/done`, { body: { period: it.period, status, doneOn, note: note || undefined } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["compliance"] }); onClose(); } });
  return <Card><h2>{it.title}</h2>
    <p className="k">{it.due ? `Due ${dd(it.due)}. ` : ""}{it.dueText}. {it.law}.</p>
    <div className="row-gap"><Field label="Done on"><input type="date" value={doneOn} onChange={(e) => setDoneOn(e.target.value)} /></Field>
      <Field label="Note (acknowledgement or challan number, optional)"><input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></Field></div>
    {m.error && <ErrorNote error={m.error} />}
    <div className="row-gap"><button className="btn primary" disabled={m.isPending} onClick={() => m.mutate("done")}>Mark done</button>
      <button className="btn" disabled={m.isPending} onClick={() => m.mutate("na")}>Not needed this time</button>
      <button className="btn" onClick={onClose}>Cancel</button></div></Card>;
}

function Profile({ d }: { d: Resp }) {
  const qc = useQueryClient();
  const [p, setP] = useState(d.facts);
  useEffect(() => setP(d.facts), [d.facts]);
  const save = useMutation({ mutationFn: () => api("/compliance/profile", { method: "PUT", body: { entity: p.entity, industry: p.industry, turnoverBand: p.turnoverBand, gstRegistered: p.gstRegistered, dpiit: p.dpiit, foreignInvestment: p.foreignInvestment, msme: p.msme, msmeVendors: p.msmeVendors, incorporatedOn: p.incorporatedOn || null, extraStates: p.extraStates } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["compliance"] }) });
  const tick = (k: "gstRegistered" | "dpiit" | "foreignInvestment" | "msme" | "msmeVendors", label: string) => <label className="dt-group"><input type="checkbox" checked={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.checked })} /> {label}</label>;
  return <Card><h2>Company profile</h2>
    <p className="k">Headcount, interns and office states come from People and Organisation and update by themselves: <b>{d.facts.headcount} employees</b>, <b>{d.facts.interns} interns</b>, offices in <b>{d.facts.officeStates.join(" and ") || "no state set yet"}</b>. The rest is set here.</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: "0 12px" }}>
      <Field label="Type of entity"><select value={p.entity} onChange={(e) => setP({ ...p, entity: e.target.value as Facts["entity"] })}>{Object.entries(ENTITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Industry"><select value={p.industry} onChange={(e) => setP({ ...p, industry: e.target.value })}>{d.options.industries.map((i) => <option key={i}>{i}</option>)}</select></Field>
      <Field label="Turnover last year"><select value={p.turnoverBand} onChange={(e) => setP({ ...p, turnoverBand: e.target.value })}>{Object.entries(d.options.turnoverBands).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Incorporated on"><input type="date" value={p.incorporatedOn ?? ""} onChange={(e) => setP({ ...p, incorporatedOn: e.target.value || null })} /></Field>
      <Field label="Other states with staff or registrations"><select multiple size={3} value={p.extraStates} onChange={(e) => setP({ ...p, extraStates: [...e.target.selectedOptions].map((o) => o.value) })}>{d.options.states.filter((s) => !d.facts.officeStates.includes(s)).map((s) => <option key={s}>{s}</option>)}</select></Field>
    </div>
    <div className="row-gap" style={{ margin: "8px 0 12px" }}>{tick("gstRegistered", "GST registered")}{tick("dpiit", "DPIIT recognised startup")}{tick("foreignInvestment", "Has foreign investment (FDI)")}{tick("msme", "Registered as MSME (Udyam)")}{tick("msmeVendors", "Buys from MSME suppliers")}</div>
    {save.error && <ErrorNote error={save.error} />}
    <button className="btn primary" disabled={save.isPending} onClick={() => save.mutate()}>{save.isSuccess ? "Saved" : "Save profile"}</button></Card>;
}

function History() {
  const q = useQuery({ queryKey: ["compliance", "history"], queryFn: () => api<Hist[]>("/compliance/history") });
  const qc = useQueryClient();
  const undo = useMutation({ mutationFn: (h: Hist) => api(`/compliance/${h.itemKey}/undo`, { body: { period: h.period } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["compliance"] }) });
  if (q.error) return <ErrorNote error={q.error} />;
  const cols: Col<Hist>[] = [
    { key: "title", label: "Item", value: (h) => h.title, filter: true },
    { key: "period", label: "Period", value: (h) => h.period },
    { key: "status", label: "Outcome", value: (h) => (h.status === "done" ? "Done" : "Not needed"), filter: true },
    { key: "doneOn", label: "Done on", value: (h) => h.doneOn, render: (h) => dd(h.doneOn) },
    { key: "note", label: "Note", value: (h) => h.note },
    { key: "by", label: "By", value: (h) => h.by, filter: true },
    { key: "undo", label: "", value: () => null, render: (h) => <button className="btn" onClick={() => undo.mutate(h)}>Undo</button> },
  ];
  return <Card><DataTable rows={q.data ?? []} cols={cols} rowKey={(h) => h.id} file="compliance-history" empty="Nothing marked done yet." initialSort={{ key: "doneOn", dir: -1 }} /></Card>;
}

export default function Compliance() {
  const q = useQuery({ queryKey: ["compliance"], queryFn: () => api<Resp>("/compliance") });
  const [tab, setTab] = useState("items");
  const [mark, setMark] = useState<Item | null>(null);
  const [showNa, setShowNa] = useState(false);
  if (q.error) return <Page title="Compliance"><ErrorNote error={q.error} /></Page>;
  if (!q.data) return <Page title="Compliance"><Card><p>Loading…</p></Card></Page>;
  const d = q.data, items = d.items;
  const byStatus = (a: Item, b: Item) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || (a.due ?? "9").localeCompare(b.due ?? "9");
  const all = [...items].sort(byStatus);
  const applies = all.filter((i) => i.need !== "Not applicable");
  const count = (s: string) => applies.filter((i) => i.status === s).length;
  const cols: Col<Item>[] = [
    { key: "title", label: "What", value: (i) => i.title, render: (i) => <div><b>{i.title}</b><div className="k">{i.law}{i.form ? ` · Form ${i.form}` : ""}</div></div> },
    { key: "category", label: "Area", value: (i) => i.category, filter: true },
    { key: "need", label: "Requirement", value: (i) => i.need, filter: true, render: (i) => <span title={i.why}><Chip tone={i.need === "Mandatory" ? "info" : "mute"}>{i.need}</Chip><div className="k">{i.why}</div></span> },
    { key: "frequency", label: "How often", value: (i) => i.frequency, filter: true },
    { key: "due", label: "Next due", value: (i) => i.due, render: (i) => <div>{i.due ? <b>{dd(i.due)}</b> : null}<div className="k">{i.dueText}</div></div> },
    { key: "status", label: "Status", value: (i) => i.status, filter: true, render: (i) => <div><Chip tone={tone(i.status)}>{i.status}</Chip>{i.last && <div className="k">Last: {i.last.status === "done" ? "done" : "not needed"} {dd(i.last.doneOn)}</div>}</div> },
    { key: "act", label: "", value: () => null, render: (i) => <div className="row-gap" style={{ flexWrap: "nowrap" }}>
      {i.period && i.status !== "Done" && i.status !== "Not applicable" && <button className="btn" onClick={() => setMark(i)}>Mark done</button>}
      {i.template && <button className="btn" onClick={() => openHtml(`/compliance/templates/${i.template}`)}>Template</button>}
      {i.portal && <a className="btn" href={i.portal} target="_blank" rel="noreferrer">Portal</a>}</div> },
  ];
  return <Page title="Compliance">
    <div className="tabs" role="tablist">{[["items", "What to do"], ["profile", "Company profile"], ["history", "Done so far"]].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
    {tab === "items" && <>
      <div className="dash-kpis">
        <Stat label="Apply to you" value={applies.length} sub={`${applies.filter((i) => i.need === "Mandatory").length} mandatory`} />
        <Stat label="Overdue or not marked" value={count("Overdue")} sub="due in the last 45 days" />
        <Stat label="Due in 30 days" value={count("Due in 30 days")} sub={`and ${count("To do")} one-time to do`} />
        <Stat label="Team size" value={d.facts.headcount + d.facts.interns} sub={`${d.facts.headcount} employees, ${d.facts.interns} interns`} />
      </div>
      {mark && <MarkDone it={mark} onClose={() => setMark(null)} />}
      <Card>
        <p className="k">Worked out from your headcount, interns, office states ({d.facts.states.join(", ") || "none set"}) and the company profile. Due dates are the standard ones; government extensions are not tracked. Hover a requirement to see why it applies.</p>
        <DataTable rows={showNa ? all : applies} cols={cols} rowKey={(i) => i.key} file="compliance" groupBy={(i) => i.category} groupOrder={CATEGORIES}
          rowClass={(i) => (i.status === "Overdue" ? "dt-overdue" : undefined)}
          toolbar={<label className="dt-group"><input type="checkbox" checked={showNa} onChange={(e) => setShowNa(e.target.checked)} /> Show items that do not apply</label>} />
      </Card>
    </>}
    {tab === "profile" && <Profile d={d} />}
    {tab === "history" && <History />}
  </Page>;
}
