import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fileToBase64, getAuthToken } from "../lib/api";
import { openHtml } from "../lib/openHtml";
import { Card, Chip, ErrorNote, Field, Page, inr } from "../lib/ui";

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
  tds: { enabled: boolean; slabs: { upToPaise: number | null; rateBps: number }[]; standardDeductionPaise: number; cessBps: number; rebate?: { thresholdPaise: number; maxRebatePaise: number } };
  professionalTax: { enabled: boolean; monthlyPaise: number };
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
  const [tab, setTab] = useState("runs");
  const tabs: [string, string][] = [["runs", "Runs"], ["advice", "Bank advice"], ["rules", "Statutory rules"], ...(isHr ? [["templates", "Salary templates"], ["comp", "Compensation"]] as [string, string][] : []), ["sign", "Signatories"]];
  return (
    <Page title="Payroll">
      <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === "runs" && <Runs canRun={isHr} />}
      {tab === "advice" && <BankAdvice canSign={isFin} />}
      {tab === "rules" && <RulesTab />}
      {tab === "templates" && isHr && <Templates />}
      {tab === "comp" && isHr && <Compensation />}
      {tab === "sign" && <Signatories isHr={isHr} isFin={isFin} />}
    </Page>
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
function RulesTab() {
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
      <div className="note warn"><strong>Nothing is pre-filled.</strong> Statutory values (PF, TDS slabs, professional tax) must be confirmed from official sources (EPFO, the Income Tax Department, your state notification) before you enter them. Every rule set records its source and who added it. Payroll runs cannot be created until a rule set is effective for the month.</div>
      <Card>
        <h2>Rule sets</h2>
        <ErrorNote error={rules.error} />
        {rules.isLoading ? <p>Loading…</p> : !rules.data?.history.length ? <p className="k">No rule sets configured.</p> : (
          <div style={tableWrap}><table className="t"><thead><tr><th>Effective from</th><th>PF</th><th>TDS</th><th>Prof. tax</th><th>Source</th><th>Added by</th></tr></thead><tbody>
            {rules.data.history.map((h) => (
              <tr key={h.id}><td>{h.effectiveFrom} {rules.data!.current?.id === h.id && <Chip tone="ok">Current</Chip>}</td>
                <td>{h.rules.pf.enabled ? `${bpsPct(h.rules.pf.employeeBps)} / ${bpsPct(h.rules.pf.employerBps)}` : "Off"}</td>
                <td>{h.rules.tds.enabled ? `${h.rules.tds.slabs.length} slabs, cess ${bpsPct(h.rules.tds.cessBps)}` : "Off"}</td>
                <td>{h.rules.professionalTax.enabled ? inr(h.rules.professionalTax.monthlyPaise) + "/mo" : "Off"}</td>
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

function Templates() {
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
        <h2>{editId ? "Edit template" : "New template"}</h2>
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
  const emps = useQuery({ queryKey: ["employees-all"], queryFn: () => api<{ employees: Employee[] }>("/employees") });
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
function Signatories({ isHr, isFin }: { isHr: boolean; isFin: boolean }) {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["signatories"], queryFn: () => api<Signatory[]>("/signatories") });
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
            {list.data.map((s) => <tr key={s.id}><td>{s.displayName}</td><td>{s.designation}</td><td>{s.email}</td><td>{s.hasSignature ? <Chip tone="ok">Uploaded</Chip> : <Chip tone="warn">Missing</Chip>}</td><td>{s.hasStamp ? <Chip tone="ok">Uploaded</Chip> : <Chip tone="mute">None</Chip>}</td></tr>)}
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
          <p className="k">PNG or JPEG. These appear on bank advice letters you sign. A signature is required before you can sign.</p>
          <div className="grid">
            <Field label="Signature image"><input type="file" accept="image/png,image/jpeg" onChange={(e) => { upload("signature", e.target.files?.[0]); e.target.value = ""; }} /></Field>
            <Field label="Company stamp image"><input type="file" accept="image/png,image/jpeg" onChange={(e) => { upload("stamp", e.target.files?.[0]); e.target.value = ""; }} /></Field>
          </div>
          {msg && <div className="note info" style={{ marginTop: 12 }} role="status">{msg}</div>}
        </Card>
      )}
    </>
  );
}
