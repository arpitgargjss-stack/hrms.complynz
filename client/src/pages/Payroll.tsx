import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fileToBase64, getAuthToken } from "../lib/api";
import { ConfigHint } from "../lib/ConfigHint";
import { openHtml } from "../lib/openHtml";
import { Card, Chip, ErrorNote, Field, Page, inr } from "../lib/ui";
import { RULE_PRESETS, TEMPLATE_PRESETS } from "../../../shared/hr/presets";

type Me = { email: string; employeeId: string | null; roles: string[] };
type RunRow = { id: string; month: string; status: string; lockedAt: string | null; lockedBy: string | null; headcount: number; netPayPaise: number; exceptionCount: number };
type Totals = { headcount: number; grossPaidPaise: number; deductionsPaise: number; reimbursementsPaise: number; netPayPaise: number; employerContributionsPaise: number };
type Line = { code: string; name: string; amount: number };
type RunDetail = {
  id: string; month: string; status: string; lockedBy: string | null; lockedAt: string | null; ruleEffectiveFrom: string; totals: Totals;
  exceptions: { employeeId: string; code: string; name: string; message: string }[];
  payslips: { id: string; code: string; name: string; paidDays: number; calendarDays: number; netPayPaise: number }[];
};
type Advice = { id: string; runId: string; refNo: string; totalPaise: number; rowCount: number; contentHash: string; signedBy: string | null; signedAt: string | null; createdAt: string };
type AdviceDetail = Advice & { month: string; integrity: "ok" | "changed"; rows: { srNo: number; name: string; bankName: string; accountNo: string; ifsc: string; amountPaise: number }[] };
type Template = { id: string; name: string; components: Component[] };
type Component = { code: string; name: string; calc: { type: "fixed"; amount: number } | { type: "percent"; of: string; bps: number } | { type: "balance" }; pfWage?: boolean; taxable?: boolean };
type Employee = { id: string; code: string; fullName: string };
type Signatory = { id: string; email: string; displayName: string; designation: string; hasSignature: boolean; hasStamp: boolean };
type RuleRow = { id: string; effectiveFrom: string; source: string; createdBy: string; rules: Rules };
type Rules = {
  pf: { enabled: boolean; employeeBps: number; employerBps: number; wageCeilingPaise: number | null };
  esi?: { enabled: boolean; employeeBps: number; employerBps: number; wageCeilingPaise: number };
  tds: { enabled: boolean; slabs: { upToPaise: number | null; rateBps: number }[]; standardDeductionPaise: number; cessBps: number; rebate?: { thresholdPaise: number; maxRebatePaise: number } };
  professionalTax: { enabled: boolean; monthlyPaise: number; byState?: Record<string, unknown> };
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const thisMonth = () => new Date().toISOString().slice(0, 7);
const today = () => new Date().toISOString().slice(0, 10);
const rupeesToPaise = (s: string) => Math.round(Number(s) * 100);
const bpsPct = (b: number) => `${(b / 100).toFixed(2)}%`;
const statusTone = (s: string) => (s === "draft" ? "warn" : s === "paid" ? "ok" : "info") as "warn" | "ok" | "info";
const tableWrap = { overflowX: "auto" as const };

export default function Payroll() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
  const roles = new Set(me.data?.roles ?? []);
  const isHr = roles.has("hr_admin"), isFin = roles.has("finance_signatory");
  const canRun = isHr || isFin; // finance has the same payroll rights as HR admin
  const [tab, setTab] = useState("overview");
  const tabs: [string, string][] = [["overview", "Overview"], ["runs", "Runs"], ["advice", "Bank advice"], ["rules", "Statutory rules"], ...(canRun ? [["templates", "Salary templates"], ["comp", "Compensation"]] as [string, string][] : []), ["sign", "Signatories"]];
  return (
    <Page title="Payroll">
      <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === "overview" && <Overview go={setTab} canRun={canRun} />}
      {tab === "runs" && <Runs canRun={canRun} />}
      {tab === "advice" && <BankAdvice canSign={isFin} />}
      {tab === "rules" && <><ConfigHint tab="pay" label="Pay and money" /><RulesTab /></>}
      {tab === "templates" && canRun && <><ConfigHint tab="pay" label="Pay and money" /><Templates /></>}
      {tab === "comp" && canRun && <Compensation />}
      {tab === "sign" && <Signatories isHr={isHr} isFin={isFin} />}
    </Page>
  );
}

// ------------------------------------------------------------------ Overview
type OverviewData = { month: string; setup: { key: string; label: string; ok: boolean; detail: string; tab: string }[]; strip: { month: string; status: string; runId: string | null; payslips: number; netPayPaise: number }[] };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STRIP: Record<string, { label: string; bg: string; fg: string; border: string }> = {
  none: { label: "No run", bg: "transparent", fg: "var(--mute)", border: "1.5px dashed #c9d2e6" },
  draft: { label: "Draft", bg: "#f0f5ff", fg: "#1e3a8a", border: "1.5px solid #bfdbfe" },
  locked: { label: "Locked", bg: "#0048e4", fg: "#fff", border: "1.5px solid #0048e4" },
  paid: { label: "Paid", bg: "#00339f", fg: "#fff", border: "1.5px solid #00339f" },
  imported: { label: "Imported", bg: "#dbe6ff", fg: "#0039b8", border: "1.5px solid #93b4ff" },
};
function Overview({ go, canRun }: { go: (t: string) => void; canRun: boolean }) {
  const q = useQuery({ queryKey: ["payroll-overview"], queryFn: () => api<OverviewData>("/payroll/overview") });
  if (q.error) return <ErrorNote error={q.error} />;
  if (!q.data) return <Card><p>Loading…</p></Card>;
  const d = q.data, done = d.setup.filter((x) => x.ok).length;
  return (
    <>
      <Card>
        <div className="row-gap" style={{ justifyContent: "space-between", alignItems: "baseline" }}><h2 style={{ margin: 0 }}>Last 12 months</h2><span className="k">Click a month to open its run.</span></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 8, marginTop: 14 }}>
          {d.strip.map((m) => { const st = STRIP[m.status] ?? STRIP.none; return (
            <button key={m.month} type="button" onClick={() => go("runs")} title={`${m.month}: ${st.label}${m.payslips ? `, ${m.payslips} payslips, ${inr(m.netPayPaise)}` : ""}`}
              style={{ font: "inherit", textAlign: "left", cursor: "pointer", borderRadius: 12, padding: "10px 10px 8px", background: st.bg, color: st.fg, border: st.border, minHeight: 86, display: "flex", flexDirection: "column", gap: 2 }}>
              <b style={{ fontSize: 13 }}>{MON[Number(m.month.slice(5, 7)) - 1]} {m.month.slice(2, 4)}</b>
              <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.9 }}>{st.label}</span>
              {m.payslips > 0 && <span style={{ fontSize: 11, opacity: 0.85, marginTop: "auto" }}>{m.payslips} slips · {inr(m.netPayPaise).replace(/\.00$/, "")}</span>}
            </button>); })}
        </div>
        <div className="k" style={{ display: "flex", gap: 14, marginTop: 10, flexWrap: "wrap" }}>{Object.entries(STRIP).map(([k, v]) => <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span aria-hidden style={{ width: 12, height: 12, borderRadius: 4, background: v.bg, border: v.border }} />{v.label}</span>)}</div>
      </Card>
      {canRun && <ImportPast strip={d.strip} />}
      <Card>
        <div className="row-gap" style={{ justifyContent: "space-between", alignItems: "baseline" }}><h2 style={{ margin: 0 }}>Payroll set-up</h2><span className="k">{done} of {d.setup.length} ready</span></div>
        <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
          {d.setup.map((x) => (
            <div key={x.key} className="row-gap" style={{ justifyContent: "space-between", padding: "12px 0", borderTop: "1px solid var(--line)" }}>
              <span style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span aria-hidden style={{ width: 24, height: 24, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, background: x.ok ? "#0048e4" : "#f0f5ff", color: x.ok ? "#fff" : "#0039b8", border: x.ok ? "none" : "1.5px solid #bfdbfe" }}>{x.ok ? "✓" : "!"}</span>
                <span><b style={{ display: "block", fontSize: 14 }}>{x.label}</b><span className="k">{x.detail}</span></span>
              </span>
              <span className="row-gap" style={{ alignItems: "center" }}><Chip tone={x.ok ? "ok" : "warn"}>{x.ok ? "Done" : "Missing"}</Chip>{(canRun || x.tab === "rules" || x.tab === "sign") && <button className="btn" onClick={() => go(x.tab)}>{x.ok ? "Review" : "Set up"}</button>}</span>
            </div>))}
        </div>
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ Import months paid outside the HRMS
type ImportPreview = { month: string; replaces: boolean; issues: { row: number; code: string; message: string }[]; rows: { code: string; name: string; paidDays: number; grossPaise: number; deductionsPaise: number; netPayPaise: number }[]; totals: { payslips: number; grossPaise: number; netPayPaise: number }; notInFile: string[] };
function ImportPast({ strip }: { strip: OverviewData["strip"] }) {
  const qc = useQueryClient();
  const past = strip.slice(0, -1).filter((m) => m.status === "none" || m.status === "imported").reverse();
  const [month, setMonth] = useState(past[0]?.month ?? "");
  const [file, setFile] = useState<{ name: string; b64: string } | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const status = strip.find((m) => m.month === month);
  const label = (m: string) => `${MON[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
  const preview = useMutation({ mutationFn: (f: { b64: string }) => api<ImportPreview>("/payroll/import/preview", { body: { month, fileBase64: f.b64 } }) });
  const save = useMutation({
    mutationFn: () => api<{ payslips: number }>("/payroll/import", { body: { month, fileBase64: file!.b64 } }),
    onSuccess: (r) => { setDone(`${label(month)} imported: ${r.payslips} payslips are now in My payslips.`); setFile(null); preview.reset(); qc.invalidateQueries({ queryKey: ["payroll-overview"] }); qc.invalidateQueries({ queryKey: ["payroll-runs"] }); },
  });
  const undo = useMutation({
    mutationFn: () => api(`/payroll/import/${status!.runId}`, { method: "DELETE" }),
    onSuccess: () => { setDone(`${label(month)} import removed.`); qc.invalidateQueries({ queryKey: ["payroll-overview"] }); qc.invalidateQueries({ queryKey: ["payroll-runs"] }); },
  });
  const download = async () => {
    setErr(null);
    try {
      const token = await getAuthToken();
      const res = await fetch(`/api/payroll/import/template?month=${month}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error);
      const url = URL.createObjectURL(await res.blob()), a = document.createElement("a");
      a.href = url; a.download = `complynz-payroll-${month}.xlsx`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { setErr(e); }
  };
  const pick = async (f: File | undefined) => {
    setDone(null); preview.reset(); if (!f) { setFile(null); return; }
    const b64 = await fileToBase64(f); setFile({ name: f.name, b64 }); preview.mutate({ b64 });
  };
  const p = preview.data;
  if (!past.length) return null;
  return (
    <Card>
      <div className="row-gap" style={{ justifyContent: "space-between", alignItems: "baseline" }}><h2 style={{ margin: 0 }}>Import months paid outside the system</h2><span className="k">Payslips appear for employees once imported.</span></div>
      <ol className="k" style={{ margin: "10px 0 14px", paddingLeft: 18, lineHeight: 1.7 }}>
        <li>Pick the month and download its template. It lists everyone employed that month.</li>
        <li>Fill in what was actually paid, in rupees, and save it.</li>
        <li>Upload it, check the preview, then import.</li>
      </ol>
      <div className="row-gap" style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
        <Field label="Month"><select value={month} onChange={(e) => { setMonth(e.target.value); setFile(null); preview.reset(); setDone(null); }}>
          {past.map((m) => <option key={m.month} value={m.month}>{label(m.month)}{m.status === "imported" ? " (imported, re-upload replaces it)" : ""}</option>)}</select></Field>
        <button className="btn" onClick={download} disabled={!month}>Download template</button>
        <label className="btn" style={{ display: "inline-flex", alignItems: "center", cursor: "pointer" }}>{file ? `File: ${file.name}` : "Upload filled file"}
          <input type="file" accept=".xlsx,.csv" style={{ display: "none" }} onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} /></label>
        {status?.status === "imported" && <button className="btn" disabled={undo.isPending} onClick={() => { if (window.confirm(`Remove the imported payslips for ${label(month)}?`)) undo.mutate(); }}>Remove this import</button>}
      </div>
      <ErrorNote error={err ?? preview.error ?? save.error ?? undo.error} />
      {done && <div className="note ok" role="status" style={{ marginTop: 12 }}>{done}</div>}
      {preview.isPending && <p className="k">Checking the file…</p>}
      {p && <div style={{ marginTop: 14 }}>
        {p.issues.length > 0 && <div className="note bad" role="alert"><b>{p.issues.length} problem{p.issues.length > 1 ? "s" : ""} to fix before importing</b>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{p.issues.slice(0, 12).map((x, i) => <li key={i}>Row {x.row}{x.code ? ` (${x.code})` : ""}: {x.message}</li>)}</ul></div>}
        {p.notInFile.length > 0 && <div className="note warn" role="status" style={{ marginTop: 8 }}>Not in the file, so they get no payslip for {label(p.month)}: {p.notInFile.join(", ")}.</div>}
        {p.rows.length > 0 && <div style={tableWrap}><table className="t" style={{ marginTop: 10 }}><thead><tr><th>Code</th><th>Name</th><th>Paid days</th><th>Gross</th><th>Deductions</th><th>Net pay</th></tr></thead><tbody>
          {p.rows.map((x) => <tr key={x.code}><td>{x.code}</td><td>{x.name}</td><td>{x.paidDays}</td><td>{inr(x.grossPaise)}</td><td>{inr(x.deductionsPaise)}</td><td><b>{inr(x.netPayPaise)}</b></td></tr>)}
          <tr><td colSpan={3}><b>{p.totals.payslips} payslips</b></td><td><b>{inr(p.totals.grossPaise)}</b></td><td></td><td><b>{inr(p.totals.netPayPaise)}</b></td></tr></tbody></table></div>}
        <p style={{ marginTop: 12 }}><button className="btn p" disabled={!!p.issues.length || !p.rows.length || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Importing…" : p.replaces ? `Replace ${label(p.month)} import` : `Import ${label(p.month)}`}</button>
          <span className="k" style={{ marginLeft: 10 }}>Imported months are marked paid. They never create a bank advice and never pick up reimbursement claims.</span></p>
      </div>}
    </Card>
  );
}

// ------------------------------------------------------------------ Runs
function Runs({ canRun }: { canRun: boolean }) {
  const qc = useQueryClient();
  const [month, setMonth] = useState(thisMonth());
  const [openId, setOpenId] = useState<string | null>(null);
  const runs = useQuery({ queryKey: ["payroll-runs"], queryFn: () => api<RunRow[]>("/payroll/runs") });
  const create = useMutation({
    mutationFn: () => api<{ runId: string }>("/payroll/runs", { body: { month } }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["payroll-runs"] }); setOpenId(r.runId); },
  });
  return (
    <>
      {canRun && (
        <Card>
          <h2>Create or rebuild a draft run</h2>
          <div className="grid" style={{ alignItems: "end" }}>
            <Field label="Month"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
            <div><button className="btn p" disabled={!month || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Building…" : "Create draft run"}</button></div>
          </div>
          <p className="k">Uses the statutory rules effective for that month. Rebuilding an existing draft replaces its payslips. A locked month cannot be rebuilt.</p>
          <ErrorNote error={create.error} />
        </Card>
      )}
      <Card>
        <h2>Payroll runs</h2>
        <ErrorNote error={runs.error} />
        {runs.isLoading ? <p>Loading…</p> : !runs.data?.length ? <p className="k">No runs yet.</p> : (
          <div style={tableWrap}><table className="t"><thead><tr><th>Month</th><th>Status</th><th>Headcount</th><th>Net pay</th><th>Exceptions</th><th></th></tr></thead><tbody>
            {runs.data.map((r) => (
              <tr key={r.id}><td>{monthLabel(r.month)}</td><td><Chip tone={statusTone(r.status)}>{r.status}</Chip></td><td>{r.headcount}</td><td>{inr(r.netPayPaise)}</td>
                <td>{r.exceptionCount ? <Chip tone="bad">{r.exceptionCount}</Chip> : <Chip tone="ok">None</Chip>}</td>
                <td><button className="btn" onClick={() => setOpenId(openId === r.id ? null : r.id)}>{openId === r.id ? "Close" : "Open"}</button></td></tr>
            ))}
          </tbody></table></div>
        )}
      </Card>
      {openId && <RunDetailView id={openId} canRun={canRun} />}
    </>
  );
}

function RunDetailView({ id, canRun }: { id: string; canRun: boolean }) {
  const qc = useQueryClient();
  const d = useQuery({ queryKey: ["payroll-run", id], queryFn: () => api<RunDetail>(`/payroll/runs/${id}`) });
  const [ack, setAck] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["payroll-run", id] }); qc.invalidateQueries({ queryKey: ["payroll-runs"] }); };
  const recompute = useMutation({ mutationFn: () => api(`/payroll/runs/${id}/recompute`, { method: "POST", body: {} }), onSuccess: () => { setAck(false); refresh(); } });
  const lock = useMutation({ mutationFn: (acknowledgeExceptions: boolean) => api(`/payroll/runs/${id}/lock`, { body: { acknowledgeExceptions } }), onSuccess: refresh });
  if (d.isLoading) return <Card><p>Loading…</p></Card>;
  if (d.error || !d.data) return <ErrorNote error={d.error} />;
  const run = d.data, hasExc = run.exceptions.length > 0, draft = run.status === "draft";
  const t = run.totals;
  return (
    <Card>
      <div className="pagehead"><h2 style={{ margin: 0 }}>{monthLabel(run.month)} <Chip tone={statusTone(run.status)}>{run.status}</Chip></h2>
        <span className="k">Rules effective {run.ruleEffectiveFrom}{run.lockedAt ? ` · locked ${new Date(run.lockedAt).toLocaleDateString()} by ${run.lockedBy}` : ""}</span></div>
      <div className="grid">
        {([["Headcount", String(t.headcount)], ["Gross paid", inr(t.grossPaidPaise)], ["Deductions", inr(t.deductionsPaise)], ["Reimbursements", inr(t.reimbursementsPaise)], ["Net pay", inr(t.netPayPaise)], ["Employer contributions", inr(t.employerContributionsPaise)]] as const).map(([k, v]) =>
          <div key={k}><div className="k">{k}</div><div style={{ fontSize: 20, fontWeight: 600 }}>{v}</div></div>)}
      </div>
      {hasExc && (
        <div className="note warn" role="alert" style={{ marginTop: 16 }}>
          <strong>{run.exceptions.length} exception{run.exceptions.length > 1 ? "s" : ""}.</strong> These employees have no payslip in this run:
          <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>{run.exceptions.map((e) => <li key={e.employeeId}>{e.name} ({e.code}): {e.message}</li>)}</ul>
        </div>
      )}
      <h2 style={{ marginTop: 16 }}>Payslips</h2>
      <div style={tableWrap}><table className="t"><thead><tr><th>Code</th><th>Name</th><th>Paid days</th><th>Net pay</th><th></th></tr></thead><tbody>
        {run.payslips.map((p) => (
          <tr key={p.id}><td>{p.code}</td><td>{p.name}</td><td>{p.paidDays} / {p.calendarDays}</td><td>{inr(p.netPayPaise)}</td>
            <td><button className="btn" onClick={() => openHtml(`/payslips/${p.id}/html`).catch((e) => alert((e as Error).message))}>View</button></td></tr>
        ))}
      </tbody></table></div>
      {canRun && draft && (
        <div style={{ marginTop: 16 }}>
          <div className="row-gap">
            <button className="btn" disabled={recompute.isPending} onClick={() => recompute.mutate()}>{recompute.isPending ? "Recomputing…" : "Recompute draft"}</button>
          </div>
          {hasExc && (
            <label style={{ display: "flex", gap: 10, alignItems: "center", margin: "14px 0", minHeight: 44 }}>
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>I have reviewed the {run.exceptions.length} exception(s) and want to lock without them.</span>
            </label>
          )}
          <div className="row-gap" style={{ marginTop: 8 }}>
            <button className="btn p" disabled={lock.isPending || (hasExc && !ack) || !run.payslips.length}
              onClick={() => { if (confirm(`Lock ${monthLabel(run.month)}? A locked run cannot be changed and marks its reimbursement claims as paid.`)) lock.mutate(hasExc); }}>
              {lock.isPending ? "Locking…" : "Lock run"}
            </button>
          </div>
        </div>
      )}
      <ErrorNote error={recompute.error} /><ErrorNote error={lock.error} />
      {lock.isSuccess && <div className="note ok">Run locked. You can now generate the bank advice.</div>}
    </Card>
  );
}

// ------------------------------------------------------------------ Bank advice
function BankAdvice({ canSign }: { canSign: boolean }) {
  const qc = useQueryClient();
  const runs = useQuery({ queryKey: ["payroll-runs"], queryFn: () => api<RunRow[]>("/payroll/runs") });
  const advices = useQuery({ queryKey: ["bank-advices"], queryFn: () => api<Advice[]>("/bank-advices") });
  const [runId, setRunId] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const locked = (runs.data ?? []).filter((r) => r.status !== "draft");
  const gen = useMutation({
    mutationFn: () => api<Advice>(`/payroll/runs/${runId}/bank-advice`, { method: "POST", body: {} }),
    onSuccess: (a) => { qc.invalidateQueries({ queryKey: ["bank-advices"] }); setSel(a.id); },
  });
  const monthOf = (rid: string) => runs.data?.find((r) => r.id === rid)?.month;
  return (
    <>
      <Card>
        <h2>Generate from a locked run</h2>
        <div className="grid" style={{ alignItems: "end" }}>
          <Field label="Locked payroll run"><select value={runId} onChange={(e) => setRunId(e.target.value)}><option value="">Select a run</option>{locked.map((r) => <option key={r.id} value={r.id}>{monthLabel(r.month)}</option>)}</select></Field>
          <div><button className="btn p" disabled={!runId || gen.isPending} onClick={() => gen.mutate()}>{gen.isPending ? "Generating…" : "Generate bank advice"}</button></div>
        </div>
        <ErrorNote error={gen.error} />
        <p className="k">Generation fails if any employee has invalid bank details. A signed advice cannot be regenerated.</p>
      </Card>
      <Card>
        <h2>Bank advices</h2>
        <ErrorNote error={advices.error} />
        {advices.isLoading ? <p>Loading…</p> : !advices.data?.length ? <p className="k">None yet.</p> : (
          <div style={tableWrap}><table className="t"><thead><tr><th>Reference</th><th>Month</th><th>Rows</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>
            {advices.data.map((a) => (
              <tr key={a.id}><td>{a.refNo}</td><td>{monthOf(a.runId) ? monthLabel(monthOf(a.runId)!) : ""}</td><td>{a.rowCount}</td><td>{inr(a.totalPaise)}</td>
                <td>{a.signedAt ? <Chip tone="ok">Signed</Chip> : <Chip tone="warn">Unsigned</Chip>}</td>
                <td><button className="btn" onClick={() => setSel(sel === a.id ? null : a.id)}>{sel === a.id ? "Close" : "Open"}</button></td></tr>
            ))}
          </tbody></table></div>
        )}
      </Card>
      {sel && <AdviceView id={sel} canSign={canSign} />}
    </>
  );
}

function AdviceView({ id, canSign }: { id: string; canSign: boolean }) {
  const qc = useQueryClient();
  const d = useQuery({ queryKey: ["bank-advice", id], queryFn: () => api<AdviceDetail>(`/bank-advices/${id}`) });
  const [f, setF] = useState({ bank: "", branch: "", city: "", debitAccount: "", date: today() });
  const [err, setErr] = useState<string | null>(null);
  const sign = useMutation({ mutationFn: () => api(`/bank-advices/${id}/sign`, { method: "POST", body: {} }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["bank-advice", id] }); qc.invalidateQueries({ queryKey: ["bank-advices"] }); } });
  if (d.isLoading) return <Card><p>Loading…</p></Card>;
  if (d.error || !d.data) return <ErrorNote error={d.error} />;
  const a = d.data, ok = a.integrity === "ok";
  const qs = () => { const p = new URLSearchParams(); (Object.entries(f) as [string, string][]).forEach(([k, v]) => { if (v.trim()) p.set(k, v.trim()); }); return p.toString(); };
  const csv = async () => {
    setErr(null);
    try {
      const token = await getAuthToken();
      const res = await fetch(`/api/bank-advices/${id}/csv`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error((j as { error?: string }).error ?? res.statusText); }
      const url = URL.createObjectURL(await res.blob());
      const el = document.createElement("a"); el.href = url; el.download = `${a.refNo.replace(/[^\w.-]/g, "_")}.csv`; document.body.appendChild(el); el.click(); el.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) { setErr((e as Error).message); }
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Card>
      <div className="pagehead"><h2 style={{ margin: 0 }}>{a.refNo} · {monthLabel(a.month)}</h2>
        <div className="row-gap">{a.signedAt ? <Chip tone="ok">Signed by {a.signedBy}</Chip> : <Chip tone="warn">Unsigned</Chip>}
          {ok ? <Chip tone="ok">Integrity verified</Chip> : <Chip tone="bad">Changed since generated</Chip>}</div></div>
      {!ok && <div className="note bad" role="alert">Payroll or bank details changed since this advice was generated. Generate a new advice before using or signing it.</div>}
      <div className="k" style={{ wordBreak: "break-all" }}>Content hash {a.contentHash}</div>
      <p><strong>{a.rowCount}</strong> transfers · total <strong>{inr(a.totalPaise)}</strong></p>
      <div style={tableWrap}><table className="t"><thead><tr><th>#</th><th>Name</th><th>Bank</th><th>Account</th><th>IFSC</th><th>Amount</th></tr></thead><tbody>
        {a.rows.map((r) => <tr key={r.srNo}><td>{r.srNo}</td><td>{r.name}</td><td>{r.bankName}</td><td>{r.accountNo}</td><td>{r.ifsc}</td><td>{inr(r.amountPaise)}</td></tr>)}
      </tbody></table></div>
      <h2 style={{ marginTop: 16 }}>Letter details</h2>
      <div className="grid">
        <Field label="Bank"><input value={f.bank} onChange={set("bank")} /></Field>
        <Field label="Branch"><input value={f.branch} onChange={set("branch")} /></Field>
        <Field label="City"><input value={f.city} onChange={set("city")} /></Field>
        <Field label="Debit account number"><input value={f.debitAccount} onChange={set("debitAccount")} inputMode="numeric" /></Field>
        <Field label="Date"><input type="date" value={f.date} onChange={set("date")} /></Field>
      </div>
      <div className="row-gap" style={{ marginTop: 16 }}>
        <button className="btn p" disabled={!ok} onClick={() => openHtml(`/bank-advices/${id}/html?${qs()}`).catch((e) => setErr((e as Error).message))}>Open printable letter</button>
        <button className="btn" disabled={!ok} onClick={csv}>Download CSV</button>
        {canSign && !a.signedAt && <button className="btn p" disabled={!ok || sign.isPending} onClick={() => { if (confirm(`Sign ${a.refNo} for ${inr(a.totalPaise)}? This cannot be undone.`)) sign.mutate(); }}>{sign.isPending ? "Signing…" : "Sign"}</button>}
      </div>
      {err && <div className="note bad" role="alert" style={{ marginTop: 12 }}>{err}</div>}
      <ErrorNote error={sign.error} />
      <p className="k">Full account numbers appear only in the printable letter and CSV, and opening them is audit logged.</p>
    </Card>
  );
}

// ------------------------------------------------------------------ Statutory rules
export function RulesTab() {
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: ["payroll-rules"], queryFn: () => api<{ current: RuleRow | null; history: RuleRow[] }>("/payroll/rules") });
  const blank = { effectiveFrom: "", source: "", pfOn: false, pfEmp: "", pfEr: "", pfCeil: "", tdsOn: false, slabs: "", stdDed: "", cess: "", rebThr: "", rebMax: "", ptOn: false, ptMonthly: "" };
  const [f, setF] = useState(blank);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => {
      // slabs: one per line "upToRupees,ratePercent"; blank upTo = last open slab
      const slabs = f.slabs.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const [u, r] = l.split(","); return { upToPaise: u.trim() === "" ? null : rupeesToPaise(u), rateBps: Math.round(Number(r) * 100) }; });
      const body = {
        effectiveFrom: f.effectiveFrom, source: f.source,
        rules: {
          pf: { enabled: f.pfOn, employeeBps: Math.round(Number(f.pfEmp || 0) * 100), employerBps: Math.round(Number(f.pfEr || 0) * 100), wageCeilingPaise: f.pfCeil.trim() === "" ? null : rupeesToPaise(f.pfCeil) },
          tds: { enabled: f.tdsOn, slabs, standardDeductionPaise: rupeesToPaise(f.stdDed || "0"), cessBps: Math.round(Number(f.cess || 0) * 100),
            ...(f.rebThr.trim() ? { rebate: { thresholdPaise: rupeesToPaise(f.rebThr), maxRebatePaise: rupeesToPaise(f.rebMax || "0") } } : {}) },
          professionalTax: { enabled: f.ptOn, monthlyPaise: rupeesToPaise(f.ptMonthly || "0") },
        },
      };
      return api("/payroll/rules", { body });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["payroll-rules"] }); setF(blank); },
  });
  const s = (k: keyof typeof blank) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const c = (k: keyof typeof blank) => (e: { target: { checked: boolean } }) => setF({ ...f, [k]: e.target.checked });
  const submit = () => { setLocalErr(null); if (f.source.trim().length < 5) return setLocalErr("Source is required: say where these values were confirmed."); if (!f.effectiveFrom) return setLocalErr("Effective from date is required."); add.mutate(); };
  return (
    <>
      <RulePresets have={new Set((rules.data?.history ?? []).map((h) => h.effectiveFrom))} />
      <Card>
        <h2>Rule sets</h2>
        <ErrorNote error={rules.error} />
        {rules.isLoading ? <p>Loading…</p> : !rules.data?.history.length ? <p className="k">No rule sets configured.</p> : (
          <div style={tableWrap}><table className="t"><thead><tr><th>Effective from</th><th>PF</th><th>TDS</th><th>Prof. tax</th><th>ESI</th><th>Source</th><th>Added by</th></tr></thead><tbody>
            {rules.data.history.map((h) => (
              <tr key={h.id}><td>{h.effectiveFrom} {rules.data!.current?.id === h.id && <Chip tone="ok">Current</Chip>}</td>
                <td>{h.rules.pf.enabled ? `${bpsPct(h.rules.pf.employeeBps)} / ${bpsPct(h.rules.pf.employerBps)}` : "Off"}</td>
                <td>{h.rules.tds.enabled ? `${h.rules.tds.slabs.length} slabs, cess ${bpsPct(h.rules.tds.cessBps)}` : "Off"}</td>
                <td>{!h.rules.professionalTax.enabled ? "Off" : h.rules.professionalTax.byState ? `By state: ${Object.keys(h.rules.professionalTax.byState).join(", ")}` : inr(h.rules.professionalTax.monthlyPaise) + "/mo"}</td>
                <td>{h.rules.esi?.enabled ? `${bpsPct(h.rules.esi.employeeBps)} / ${bpsPct(h.rules.esi.employerBps)} up to ${inr(h.rules.esi.wageCeilingPaise).replace(/\.00$/, "")}` : "Off"}</td>
                <td>{h.source}</td><td>{h.createdBy}</td></tr>
            ))}
          </tbody></table></div>
        )}
      </Card>
      <Card>
        <h2>Add a rule set</h2>
        <p className="k">Rule sets are append-only. To revise, add a new one with a later effective date. Amounts in rupees; rates in percent.</p>
        <div className="grid">
          <Field label="Effective from"><input type="date" value={f.effectiveFrom} onChange={s("effectiveFrom")} /></Field>
          <Field label="Source (required): document, notification or URL where values were confirmed"><input value={f.source} onChange={s("source")} required /></Field>
        </div>
        <h2 style={{ marginTop: 16 }}>Provident fund</h2>
        <label style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 44 }}><input type="checkbox" checked={f.pfOn} onChange={c("pfOn")} /> PF applies</label>
        <div className="grid">
          <Field label="Employee rate (%)"><input inputMode="decimal" value={f.pfEmp} onChange={s("pfEmp")} /></Field>
          <Field label="Employer rate (%)"><input inputMode="decimal" value={f.pfEr} onChange={s("pfEr")} /></Field>
          <Field label="Monthly wage ceiling (rupees, blank = uncapped)"><input inputMode="decimal" value={f.pfCeil} onChange={s("pfCeil")} /></Field>
        </div>
        <h2 style={{ marginTop: 16 }}>Income tax (TDS)</h2>
        <label style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 44 }}><input type="checkbox" checked={f.tdsOn} onChange={c("tdsOn")} /> TDS applies</label>
        <Field label="Slabs, one per line as: upper limit in rupees, rate % (leave the limit blank on the last line)"><textarea rows={5} value={f.slabs} onChange={s("slabs")} placeholder="limit,rate" /></Field>
        <div className="grid">
          <Field label="Standard deduction (rupees)"><input inputMode="decimal" value={f.stdDed} onChange={s("stdDed")} /></Field>
          <Field label="Cess (%)"><input inputMode="decimal" value={f.cess} onChange={s("cess")} /></Field>
          <Field label="Rebate threshold (rupees, optional)"><input inputMode="decimal" value={f.rebThr} onChange={s("rebThr")} /></Field>
          <Field label="Maximum rebate (rupees)"><input inputMode="decimal" value={f.rebMax} onChange={s("rebMax")} /></Field>
        </div>
        <h2 style={{ marginTop: 16 }}>Professional tax</h2>
        <label style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 44 }}><input type="checkbox" checked={f.ptOn} onChange={c("ptOn")} /> Professional tax applies</label>
        <Field label="Monthly amount (rupees)"><input inputMode="decimal" value={f.ptMonthly} onChange={s("ptMonthly")} /></Field>
        <div style={{ marginTop: 16 }}><button className="btn p" disabled={add.isPending} onClick={submit}>{add.isPending ? "Saving…" : "Add rule set"}</button></div>
        {localErr && <div className="note bad" role="alert" style={{ marginTop: 12 }}>{localErr}</div>}
        <ErrorNote error={add.error} />
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ Salary templates
const calcText = (c: Component["calc"]) => (c.type === "fixed" ? `Fixed ${inr(c.amount)}` : c.type === "percent" ? `${bpsPct(c.bps)} of ${c.of}` : "Balance of gross");
type CompRow = { code: string; name: string; type: "fixed" | "percent" | "balance"; value: string; of: string; pfWage: boolean; taxable: boolean };
const newRow = (): CompRow => ({ code: "", name: "", type: "percent", value: "", of: "gross", pfWage: false, taxable: true });
const rowToComponent = (r: CompRow): Component => ({
  code: r.code.trim().toUpperCase(), name: r.name.trim(), pfWage: r.pfWage, taxable: r.taxable,
  calc: r.type === "fixed" ? { type: "fixed", amount: rupeesToPaise(r.value || "0") } : r.type === "percent" ? { type: "percent", of: r.of.trim() || "gross", bps: Math.round(Number(r.value || 0) * 100) } : { type: "balance" },
});
const componentToRow = (c: Component): CompRow => ({
  code: c.code, name: c.name, type: c.calc.type, pfWage: !!c.pfWage, taxable: c.taxable !== false,
  value: c.calc.type === "fixed" ? String(c.calc.amount / 100) : c.calc.type === "percent" ? String(c.calc.bps / 100) : "", of: c.calc.type === "percent" ? c.calc.of : "gross",
});

function RulePresets({ have }: { have: Set<string> }) {
  const qc = useQueryClient();
  const add = useMutation({
    mutationFn: (k: string) => { const p = RULE_PRESETS.find((x) => x.key === k)!; return api("/payroll/rules", { body: { effectiveFrom: p.effectiveFrom, source: p.source, rules: p.rules } }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["payroll-rules"] }); qc.invalidateQueries({ queryKey: ["payroll-overview"] }); },
  });
  return (
    <Card>
      <div className="row-gap" style={{ justifyContent: "space-between", alignItems: "baseline" }}><h2 style={{ margin: 0 }}>Standard rule sets for India</h2><span className="k">Checked against official and payroll sources on 21 Nov 2026</span></div>
      <p className="k" style={{ margin: "6px 0 12px" }}>Pick one and payroll is ready to run. Add both to cover months before and after the PF ceiling change. You can still add your own rule set below.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 12 }}>
        {RULE_PRESETS.map((p) => (
          <div key={p.key} style={{ border: "1px solid var(--line)", borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <b>{p.name}</b><span className="k">{p.summary}</span><span className="k">Effective from {p.effectiveFrom}</span>
            <details><summary className="k" style={{ cursor: "pointer" }}>Sources</summary><ul className="k" style={{ margin: "6px 0 0", paddingLeft: 18, wordBreak: "break-word" }}>{p.sources.map((x) => <li key={x}>{x}</li>)}</ul></details>
            <div style={{ marginTop: "auto" }}>{have.has(p.effectiveFrom) ? <Chip tone="ok">Added</Chip> : <button className="btn p" disabled={add.isPending} onClick={() => add.mutate(p.key)}>Use this</button>}</div>
          </div>))}
      </div>
      <ErrorNote error={add.error} />
    </Card>
  );
}

function TemplatePresets({ have, onCustomise }: { have: Set<string>; onCustomise: (name: string, rows: CompRow[]) => void }) {
  const qc = useQueryClient();
  const add = useMutation({
    mutationFn: (k: string) => { const t = TEMPLATE_PRESETS.find((x) => x.key === k)!; return api("/payroll/templates", { body: { name: t.name, components: t.components } }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["payroll-templates"] }); qc.invalidateQueries({ queryKey: ["payroll-overview"] }); },
  });
  return (
    <Card>
      <div className="row-gap" style={{ justifyContent: "space-between", alignItems: "baseline" }}><h2 style={{ margin: 0 }}>Standard salary structures</h2><span className="k">Basic stays at half of gross, as the Code on Wages expects</span></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12, marginTop: 12 }}>
        {TEMPLATE_PRESETS.map((t) => (
          <div key={t.key} style={{ border: "1px solid var(--line)", borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
            <b>{t.name}</b><span className="k">{t.summary}</span>
            <div className="row-gap" style={{ marginTop: "auto", alignItems: "center" }}>
              {have.has(t.name) ? <Chip tone="ok">Added</Chip> : <button className="btn p" disabled={add.isPending} onClick={() => add.mutate(t.key)}>Use this</button>}
              <button className="btn" onClick={() => onCustomise(`${t.name} (custom)`, t.components.map(componentToRow))}>Customise</button>
            </div>
          </div>))}
      </div>
      <ErrorNote error={add.error} />
    </Card>
  );
}

export function Templates() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["payroll-templates"], queryFn: () => api<Template[]>("/payroll/templates") });
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [rows, setRows] = useState<CompRow[]>([newRow()]);
  const reset = () => { setEditId(null); setName(""); setRows([newRow()]); };
  const save = useMutation({
    mutationFn: () => { const body = { name, components: rows.map(rowToComponent) }; return editId ? api(`/payroll/templates/${editId}`, { method: "PUT", body }) : api("/payroll/templates", { body }); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["payroll-templates"] }); reset(); },
  });
  const del = useMutation({ mutationFn: (id: string) => api(`/payroll/templates/${id}`, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["payroll-templates"] }) });
  const upd = (i: number, p: Partial<CompRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <>
      <TemplatePresets have={new Set((list.data ?? []).map((t) => t.name))} onCustomise={(n, r) => { setEditId(null); setName(n); setRows(r); setTimeout(() => document.getElementById("tpl-form")?.scrollIntoView({ behavior: "smooth" }), 50); }} />
      <Card>
        <h2>Salary templates</h2>
        <ErrorNote error={list.error} /><ErrorNote error={del.error} />
        {list.isLoading ? <p>Loading…</p> : !list.data?.length ? <p className="k">No templates yet.</p> : list.data.map((t) => (
          <div key={t.id} style={{ borderTop: "1px solid var(--line)", padding: "12px 0" }}>
            <div className="pagehead" style={{ marginBottom: 4 }}><strong>{t.name}</strong>
              <div className="row-gap"><button className="btn" onClick={() => { setEditId(t.id); setName(t.name); setRows(t.components.map(componentToRow)); }}>Edit</button>
                <button className="btn" disabled={del.isPending} onClick={() => { if (confirm(`Delete template ${t.name}?`)) del.mutate(t.id); }}>Delete</button></div></div>
            <div className="k">{t.components.map((c) => `${c.name} (${calcText(c.calc)})`).join(" · ")}</div>
          </div>
        ))}
      </Card>
      <Card>
        <h2 id="tpl-form">{editId ? "Edit template" : "New template"}</h2>
        <p className="k">Editing a template does not change compensation records already created from it.</p>
        <Field label="Template name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        {rows.map((r, i) => (
          <div key={i} className="grid" style={{ borderTop: "1px solid var(--line)", marginTop: 12, paddingTop: 4 }}>
            <Field label="Code (e.g. BASIC)"><input value={r.code} onChange={(e) => upd(i, { code: e.target.value })} /></Field>
            <Field label="Name"><input value={r.name} onChange={(e) => upd(i, { name: e.target.value })} /></Field>
            <Field label="Calculation"><select value={r.type} onChange={(e) => upd(i, { type: e.target.value as CompRow["type"] })}><option value="percent">Percent of gross or a component</option><option value="fixed">Fixed amount</option><option value="balance">Balance of gross</option></select></Field>
            {r.type === "percent" && <Field label="Of (gross or component code)"><input value={r.of} onChange={(e) => upd(i, { of: e.target.value })} /></Field>}
            {r.type !== "balance" && <Field label={r.type === "fixed" ? "Amount (rupees)" : "Percent"}><input inputMode="decimal" value={r.value} onChange={(e) => upd(i, { value: e.target.value })} /></Field>}
            <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}><input type="checkbox" checked={r.pfWage} onChange={(e) => upd(i, { pfWage: e.target.checked })} /> PF wage</label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}><input type="checkbox" checked={r.taxable} onChange={(e) => upd(i, { taxable: e.target.checked })} /> Taxable</label>
              {rows.length > 1 && <button className="btn" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>}
            </div>
          </div>
        ))}
        <div className="row-gap" style={{ marginTop: 16 }}>
          <button className="btn" onClick={() => setRows([...rows, newRow()])}>Add component</button>
          <button className="btn p" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : editId ? "Save changes" : "Create template"}</button>
          {editId && <button className="btn" onClick={reset}>Cancel</button>}
        </div>
        <ErrorNote error={save.error} />
      </Card>
    </>
  );
}

// ------------------------------------------------------------------ Compensation
function Compensation() {
  const qc = useQueryClient();
  const emps = useQuery({ queryKey: ["payroll-employees"], queryFn: () => api<{ employees: Employee[] }>("/payroll/employees") });
  const tpls = useQuery({ queryKey: ["payroll-templates"], queryFn: () => api<Template[]>("/payroll/templates") });
  const [empId, setEmpId] = useState("");
  const [tplId, setTplId] = useState("");
  const [gross, setGross] = useState("");
  const [from, setFrom] = useState(today());
  const [reason, setReason] = useState("");
  const grossPaise = rupeesToPaise(gross || "0");
  const history = useQuery({ queryKey: ["compensation", empId], enabled: !!empId, queryFn: () => api<{ id: string; effectiveFrom: string; monthlyGrossPaise: number; reason: string; templateId: string | null }[]>(`/employees/${empId}/compensation`) });
  const preview = useQuery({
    queryKey: ["payroll-preview", tplId, grossPaise], enabled: !!tplId && grossPaise > 0, retry: false,
    queryFn: () => api<{ lines: Line[] | { earnings?: Line[] } }>(`/payroll/preview?gross=${grossPaise}&templateId=${tplId}`),
  });
  const save = useMutation({
    mutationFn: () => api(`/employees/${empId}/compensation`, { body: { effectiveFrom: from, monthlyGrossPaise: grossPaise, templateId: tplId, reason } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["compensation", empId] }); setReason(""); },
  });
  const raw = preview.data?.lines;
  const lines: Line[] = Array.isArray(raw) ? raw : raw?.earnings ?? [];
  return (
    <>
      <Card>
        <h2>Compensation set-up</h2>
        <ErrorNote error={emps.error} /><ErrorNote error={tpls.error} />
        <div className="grid">
          <Field label="Employee"><select value={empId} onChange={(e) => setEmpId(e.target.value)}><option value="">Select</option>{(emps.data?.employees ?? []).map((e) => <option key={e.id} value={e.id}>{e.fullName} ({e.code})</option>)}</select></Field>
          <Field label="Salary template"><select value={tplId} onChange={(e) => setTplId(e.target.value)}><option value="">Select</option>{(tpls.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
          <Field label="Monthly gross (rupees)"><input inputMode="decimal" value={gross} onChange={(e) => setGross(e.target.value)} /></Field>
          <Field label="Effective from"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        </div>
        <Field label="Reason (e.g. joining, annual revision)"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <h2 style={{ marginTop: 16 }}>Live preview</h2>
        {!tplId || grossPaise <= 0 ? <p className="k">Choose a template and enter a gross to preview the monthly breakup.</p> : preview.isLoading ? <p>Calculating…</p> : preview.error ? <ErrorNote error={preview.error} /> : (
          <div style={tableWrap}><table className="t"><thead><tr><th>Component</th><th>Monthly</th></tr></thead><tbody>
            {lines.map((l) => <tr key={l.code}><td>{l.name}</td><td>{inr(l.amount)}</td></tr>)}
            <tr><td><strong>Total</strong></td><td><strong>{inr(lines.reduce((s, l) => s + l.amount, 0))}</strong></td></tr>
          </tbody></table></div>
        )}
        <div style={{ marginTop: 16 }}><button className="btn p" disabled={!empId || !tplId || grossPaise <= 0 || reason.trim().length < 3 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save compensation"}</button></div>
        <ErrorNote error={save.error} />
        {save.isSuccess && <div className="note ok" style={{ marginTop: 12 }}>Compensation saved.</div>}
      </Card>
      {empId && (
        <Card>
          <h2>Compensation history</h2>
          <ErrorNote error={history.error} />
          {history.isLoading ? <p>Loading…</p> : !history.data?.length ? <p className="k">No compensation recorded.</p> : (
            <div style={tableWrap}><table className="t"><thead><tr><th>Effective from</th><th>Monthly gross</th><th>Reason</th></tr></thead><tbody>
              {history.data.map((h) => <tr key={h.id}><td>{h.effectiveFrom}</td><td>{inr(h.monthlyGrossPaise)}</td><td>{h.reason}</td></tr>)}
            </tbody></table></div>
          )}
        </Card>
      )}
    </>
  );
}

// ------------------------------------------------------------------ Signatories
/** Same handwriting-style font stack the server uses for the default signature on letters. */
const CURSIVE = `"Snell Roundhand","Apple Chancery","Segoe Script","Brush Script MT","Lucida Handwriting","URW Chancery L",cursive`;
export function Signatories({ isHr, isFin }: { isHr: boolean; isFin: boolean }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["signatories"], queryFn: () => api<Signatory[]>("/signatories") });
  const who = useQuery({ queryKey: ["me"], queryFn: () => api<{ email: string }>("/me") });
  const mine = list.data?.find((x) => x.email.toLowerCase() === (who.data?.email ?? "").toLowerCase()) ?? null;
  const [f, setF] = useState({ email: "", displayName: "", designation: "" });
  const save = useMutation({
    mutationFn: () => api("/signatories", { method: "PUT", body: { ...(isHr && f.email ? { email: f.email } : {}), displayName: f.displayName, designation: f.designation } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["signatories"] }); setF({ email: "", displayName: "", designation: "" }); },
  });
  const [msg, setMsg] = useState<string | null>(null);
  const upload = async (kind: "stamp" | "signature", file: File | undefined) => {
    setMsg(null);
    if (!file) return;
    if (file.type !== "image/png" && file.type !== "image/jpeg") return setMsg("Use a PNG or JPEG image.");
    try {
      await api("/signatories/me/assets", { body: { kind, name: file.name, mime: file.type, dataBase64: await fileToBase64(file) } });
      qc.invalidateQueries({ queryKey: ["signatories"] }); setMsg(`${kind === "stamp" ? "Stamp" : "Signature"} uploaded.`);
    } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <>
      <Card>
        <h2>Signatories</h2>
        <ErrorNote error={list.error} />
        {list.isLoading ? <p>Loading…</p> : !list.data?.length ? <p className="k">No signatory records.</p> : (
          <div style={tableWrap}><table className="t"><thead><tr><th>Name</th><th>Designation</th><th>Email</th><th>Signature</th><th>Stamp</th></tr></thead><tbody>
            {list.data.map((s) => <tr key={s.id}><td>{s.displayName}</td><td>{s.designation}</td><td>{s.email}</td><td>{s.hasSignature ? <Chip tone="ok">Uploaded</Chip> : <span title="Used on letters until a signature image is uploaded"><span style={{ fontFamily: CURSIVE, fontSize: 24, color: "#1d2a5b", lineHeight: 1.1, display: "block" }}>{s.displayName}</span><span className="k">Handwritten-style name (default)</span></span>}</td><td>{s.hasStamp ? <Chip tone="ok">Uploaded</Chip> : <span style={{ display: "flex", alignItems: "center", gap: 8 }}><img src="/brand/company-stamp.png" alt="Default company stamp" width={44} height={44} /><span className="k">Default stamp (in use)</span></span>}</td></tr>)}
          </tbody></table></div>
        )}
      </Card>
      <Card>
        <h2>{isHr ? "Add or update a signatory" : "Update my details"}</h2>
        <div className="grid">
          {isHr && <Field label="Email"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>}
          <Field label="Display name"><input value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></Field>
          <Field label="Designation"><input value={f.designation} onChange={(e) => setF({ ...f, designation: e.target.value })} /></Field>
        </div>
        <div style={{ marginTop: 16 }}><button className="btn p" disabled={!f.displayName.trim() || !f.designation.trim() || (isHr && !f.email) || save.isPending} onClick={() => save.mutate()}>Save</button></div>
        <ErrorNote error={save.error} />
      </Card>
      {isFin && (
        <Card>
          <h2>My signature and stamp</h2>
          <p className="k">PNG or JPEG. These appear on bank advice, offer, appointment and other letters, and the NDA, that you sign. Until you upload them, your name is written in a handwriting-style script and the company stamp is used.</p>
          <div className="grid">
            <div>
              <Field label="Signature image"><input type="file" accept="image/png,image/jpeg" onChange={(e) => { upload("signature", e.target.files?.[0]); e.target.value = ""; }} /></Field>
              {mine && !mine.hasSignature && <div className="k" style={{ marginTop: 6 }}><span style={{ fontFamily: CURSIVE, fontSize: 26, color: "#1d2a5b", display: "block", lineHeight: 1.2 }}>{mine.displayName}</span>Default signature: upload to replace</div>}
            </div>
            <div>
              <Field label="Company stamp image"><input type="file" accept="image/png,image/jpeg" onChange={(e) => { upload("stamp", e.target.files?.[0]); e.target.value = ""; }} /></Field>
              {(!mine || !mine.hasStamp) && <div className="k" style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 10 }}><img src="/brand/company-stamp.png" alt="Default company stamp" width={64} height={64} />Default stamp: upload to replace</div>}
            </div>
          </div>
          {msg && <div className="note info" style={{ marginTop: 12 }} role="status">{msg}</div>}
        </Card>
      )}
    </>
  );
}
