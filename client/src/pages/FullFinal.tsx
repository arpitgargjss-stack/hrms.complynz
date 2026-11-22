import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { ConfigHint } from "../lib/ConfigHint";
import { openHtml } from "../lib/openHtml";
import { Card, Chip, ErrorNote, Field, Page, inr } from "../lib/ui";
import { DataTable } from "../lib/DataTable";
import type { FnfInput, FnfLine, FnfResult, FnfRules } from "../../../shared/hr/fnf";

type Due = { id: string; name: string; code: string; status: string; lwd: string | null };
type Settlement = { id: string; employeeId: string; name: string; code: string; status: string; letterId: string | null; paidOn: string | null; createdAt: string; result: FnfResult & { payBy?: string; lastWorkingDay?: string } };
type Draft = { employee: { id: string; name: string; code: string; joiningDate: string }; input: FnfInput; notes: { leave: string; resignation: boolean; salaryFound: boolean }; result: FnfResult; payBy: string };
const rupees = (p: number) => inr(p).replace(/\.00$/, "");
const toPaise = (s: string) => { const n = Number(s.replace(/[,₹\s]/g, "")); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0; };

function Lines({ title, lines, set }: { title: string; lines: FnfLine[]; set: (l: FnfLine[]) => void }) {
  return <div><h3>{title}</h3>{lines.map((l, i) => <div key={i} className="row-gap" style={{ marginBottom: 6 }}>
    <input style={{ flex: "2 1 200px" }} value={l.label} onChange={(e) => set(lines.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} aria-label="What" />
    <input style={{ flex: "1 1 110px" }} inputMode="decimal" value={l.amountPaise / 100} onChange={(e) => set(lines.map((x, j) => (j === i ? { ...x, amountPaise: toPaise(e.target.value) } : x)))} aria-label="Amount in rupees" />
    <button className="btn" onClick={() => set(lines.filter((_, j) => j !== i))}>Remove</button></div>)}
    <button className="btn" onClick={() => set([...lines, { label: "", amountPaise: 0 }])}>Add a line</button></div>;
}

function Work({ id, onDone }: { id: string; onDone: () => void }) {
  const d = useQuery({ queryKey: ["fnf-draft", id], queryFn: () => api<Draft>(`/fnf/draft/${id}`) });
  const [i, setI] = useState<FnfInput | null>(null);
  useEffect(() => { if (d.data) setI(d.data.input); }, [d.data]);
  const calc = useQuery({ queryKey: ["fnf-calc", i], enabled: !!i, queryFn: () => api<{ result: FnfResult; payBy: string }>("/fnf/compute", { body: i }) });
  const save = useMutation({ mutationFn: () => api(`/fnf/${id}`, { body: i }), onSuccess: onDone });
  if (d.error) return <ErrorNote error={d.error} />;
  if (!d.data || !i) return <Card><p>Working it out…</p></Card>;
  const r = calc.data?.result ?? d.data.result;
  const num = (k: keyof FnfInput, label: string, money = false) => <Field label={label}><input inputMode="decimal" value={money ? (i[k] as number) / 100 : (i[k] as number)} onChange={(e) => setI({ ...i, [k]: money ? toPaise(e.target.value) : Number(e.target.value) || 0 })} /></Field>;
  return <div style={{ display: "grid", gridTemplateColumns: "minmax(340px,1fr) minmax(300px,420px)", gap: 16, alignItems: "start" }}>
    <Card><h2>{d.data.employee.name} ({d.data.employee.code})</h2>
      <p className="k">Filled in from their salary, leave balance, resignation, assets and claims.{d.data.notes.leave ? ` Leave found: ${d.data.notes.leave}.` : ""}{!d.data.notes.salaryFound ? " No salary on record, so enter it." : ""} Change anything that is not right.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: "0 12px" }}>
        <Field label="Last working day"><input type="date" value={i.lastWorkingDay} onChange={(e) => setI({ ...i, lastWorkingDay: e.target.value })} /></Field>
        {num("monthlyGrossPaise", "Monthly gross (₹)", true)}{num("monthlyBasicPaise", "Monthly basic (₹)", true)}
        {num("unpaidDays", "Days worked, not yet paid")}{num("calendarDays", "Days in that month")}{num("encashableLeaveDays", "Leave days to encash")}
        {num("noticeRequiredDays", "Notice required (days)")}{num("noticeServedDays", "Notice served (days)")}
        <Field label="Waive notice shortfall"><label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={i.waiveNotice} onChange={(e) => setI({ ...i, waiveNotice: e.target.checked })} />Waive</label></Field>
      </div>
      <Lines title="Other amounts payable" lines={i.extraEarnings} set={(l) => setI({ ...i, extraEarnings: l })} />
      <Lines title="Recoveries and deductions" lines={i.deductions} set={(l) => setI({ ...i, deductions: l })} />
      <p className="k">Add income tax (TDS) on the settlement as a deduction line, worked out on their income for the year.</p>
    </Card>
    <Card><h2>Statement</h2>
      <table className="t"><tbody>{r.earnings.map((l, k) => <tr key={"e" + k}><td>{l.label}{l.note && <div className="k">{l.note}</div>}</td><td style={{ textAlign: "right" }}>{rupees(l.amountPaise)}</td></tr>)}
        <tr><td><b>Total payable</b></td><td style={{ textAlign: "right" }}><b>{rupees(r.totalEarningsPaise)}</b></td></tr>
        {r.deductions.map((l, k) => <tr key={"d" + k}><td>{l.label}{l.note && <div className="k">{l.note}</div>}</td><td style={{ textAlign: "right" }}>-{rupees(l.amountPaise)}</td></tr>)}
        <tr><td><b>{r.netPaise >= 0 ? "Net payable" : "Net recoverable"}</b></td><td style={{ textAlign: "right" }}><b>{rupees(Math.abs(r.netPaise))}</b></td></tr></tbody></table>
      <p className="k">Service: {r.serviceYears} completed years. Pay by {calc.data?.payBy ?? d.data.payBy} (2 working days after the last day under the Code on Wages).</p>
      <ErrorNote error={save.error ?? calc.error} />
      <button className="btn p" disabled={save.isPending} onClick={() => save.mutate()}>Save and send statement to CEO</button>
    </Card>
  </div>;
}

export function Rules() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["fnf-rules"], queryFn: () => api<FnfRules>("/fnf/rules") });
  const [f, setF] = useState<FnfRules | null>(null);
  useEffect(() => { if (q.data) setF(q.data); }, [q.data]);
  const save = useMutation({ mutationFn: () => api("/fnf/rules", { method: "PUT", body: f }), onSuccess: () => qc.invalidateQueries({ queryKey: ["fnf-rules"] }) });
  if (!f) return <Card><p>Loading…</p></Card>;
  const sel = (v: string, on: (x: "basic" | "gross") => void) => <select value={v} onChange={(e) => on(e.target.value as "basic" | "gross")}><option value="basic">Basic pay</option><option value="gross">Gross pay</option></select>;
  return <Card><h2>Settlement rules</h2><p className="k">These start from common practice in India. Change them to match your leave and notice policy.</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: "0 16px" }}>
      <Field label="Leave types that are encashed (keys, comma separated)"><input value={f.encashLeaveKeys.join(", ")} onChange={(e) => setF({ ...f, encashLeaveKeys: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} /></Field>
      <Field label="Most leave days encashed"><input type="number" value={f.encashMaxDays} onChange={(e) => setF({ ...f, encashMaxDays: Number(e.target.value) })} /></Field>
      <Field label="Leave encashed on">{sel(f.encashBasis, (x) => setF({ ...f, encashBasis: x }))}</Field>
      <Field label="Daily rate = monthly pay divided by"><select value={f.dayDivisor} onChange={(e) => setF({ ...f, dayDivisor: Number(e.target.value) })}><option value={30}>30</option><option value={26}>26 (working days)</option></select></Field>
      <Field label="Recover notice not served"><label style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={f.noticeRecovery} onChange={(e) => setF({ ...f, noticeRecovery: e.target.checked })} />Yes</label></Field>
      <Field label="Notice recovery on">{sel(f.noticeBasis, (x) => setF({ ...f, noticeBasis: x }))}</Field>
      <Field label="Gratuity applies"><label style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={f.gratuity.enabled} onChange={(e) => setF({ ...f, gratuity: { ...f.gratuity, enabled: e.target.checked } })} />Yes, from 10 employees</label></Field>
      <Field label="Gratuity after (years)"><input type="number" step="0.5" value={f.gratuity.minYears} onChange={(e) => setF({ ...f, gratuity: { ...f.gratuity, minYears: Number(e.target.value) } })} /></Field>
      <Field label="Gratuity cap (₹)"><input value={f.gratuity.capPaise / 100} onChange={(e) => setF({ ...f, gratuity: { ...f.gratuity, capPaise: toPaise(e.target.value) } })} /></Field>
      <Field label="Pay within (working days of last day)"><input type="number" value={f.payWithinWorkingDays} onChange={(e) => setF({ ...f, payWithinWorkingDays: Number(e.target.value) })} /></Field>
    </div><ErrorNote error={save.error} /><p><button className="btn p" disabled={save.isPending} onClick={() => save.mutate()}>{save.isSuccess ? "Saved" : "Save rules"}</button></p></Card>;
}

export default function FullFinal() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["fnf"], queryFn: () => api<{ settlements: Settlement[]; due: Due[] }>("/fnf") });
  const [tab, setTab] = useState("list");
  const [work, setWork] = useState<string | null>(null);
  const paid = useMutation({ mutationFn: (id: string) => api(`/fnf/${id}/paid`, { body: { paidOn: new Date().toISOString().slice(0, 10) } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["fnf"] }) });
  return <Page title="Full and final settlement">
    <div className="tabs" role="tablist">{[["list", "Settlements"], ["rules", "Rules"]].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => { setTab(k); setWork(null); }}>{l}</button>)}</div>
    <ErrorNote error={q.error ?? paid.error} />
    {tab === "rules" && <><ConfigHint tab="pay" label="Pay and money" /><Rules /></>}
    {tab === "list" && work && <><p><button className="btn" onClick={() => setWork(null)}>Back</button></p><Work id={work} onDone={() => { setWork(null); qc.invalidateQueries({ queryKey: ["fnf"] }); }} /></>}
    {tab === "list" && !work && <>
      <Card><h2>To settle</h2><DataTable rows={q.data?.due ?? []} rowKey={(x) => x.id} empty="Nobody is leaving right now." file="fnf-due"
        cols={[{ key: "name", label: "Name", value: (x) => x.name }, { key: "code", label: "Code", value: (x) => x.code }, { key: "status", label: "Status", value: (x) => (x.status === "notice" ? "On notice" : "Left"), filter: true },
          { key: "lwd", label: "Last working day", value: (x) => x.lwd }, { key: "act", label: "", value: () => null, render: (x) => <button className="btn p" onClick={() => setWork(x.id)}>Work it out</button> }]} /></Card>
      <Card><h2>Settlements</h2><DataTable rows={q.data?.settlements ?? []} rowKey={(x) => x.id} empty="No settlements yet." file="fnf" initialSort={{ key: "created", dir: -1 }}
        cols={[{ key: "name", label: "Name", value: (x) => x.name }, { key: "lwd", label: "Last day", value: (x) => x.result.lastWorkingDay ?? null }, { key: "net", label: "Net", value: (x) => x.result.netPaise, align: "right", render: (x) => rupees(x.result.netPaise) },
          { key: "due", label: "Pay by", value: (x) => x.result.payBy ?? null }, { key: "status", label: "Status", value: (x) => x.status, filter: true, render: (x) => <Chip tone={x.status === "paid" ? "ok" : "warn"}>{x.status === "paid" ? `Paid ${x.paidOn}` : "Not paid yet"}</Chip> },
          { key: "created", label: "Created", value: (x) => x.createdAt.slice(0, 10) },
          { key: "act", label: "", value: () => null, render: (x) => <div className="row-gap">{x.letterId && <button className="btn" onClick={() => openHtml(`/letters/${x.letterId}/html`)}>Statement</button>}{x.status !== "paid" && <button className="btn" onClick={() => paid.mutate(x.id)}>Mark paid</button>}</div> }]} /></Card>
      <p className="k">Each statement goes to the CEO for approval in Letters, then is issued to the person.</p></>}
  </Page>;
}
