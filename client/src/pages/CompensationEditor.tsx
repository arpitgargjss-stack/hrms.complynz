import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Card, ErrorNote, Field, inr } from "../lib/ui";

type Line = { code: string; name: string; amount: number };
type Template = { id: string; name: string };
type Employee = { id: string; code: string; fullName: string };
type CompRow = { id: string; effectiveFrom: string; monthlyGrossPaise: number; reason: string; templateId: string | null };

const today = () => new Date().toISOString().slice(0, 10);
const rupeesToPaise = (s: string) => Math.round(Number(s) * 100);
const tableWrap = { overflowX: "auto" as const };

/**
 * Record a new compensation (joining salary or a revision) with a live breakup preview.
 * Used under Payroll > Compensation (pick any employee) and on a person's page under People (employeeId fixed).
 * The server allows HR admins and finance; a super admin holds both roles.
 */
export function CompensationEditor({ employeeId }: { employeeId?: string }) {
  const qc = useQueryClient();
  const fixed = !!employeeId;
  const emps = useQuery({ queryKey: ["payroll-employees"], enabled: !fixed, queryFn: () => api<{ employees: Employee[] }>("/payroll/employees") });
  const tpls = useQuery({ queryKey: ["payroll-templates"], queryFn: () => api<Template[]>("/payroll/templates") });
  const [picked, setPicked] = useState("");
  const empId = employeeId ?? picked;
  const [tplId, setTplId] = useState("");
  const [gross, setGross] = useState("");
  const [from, setFrom] = useState(today());
  const [reason, setReason] = useState("");
  const grossPaise = rupeesToPaise(gross || "0");
  const history = useQuery({ queryKey: ["compensation", empId], enabled: !!empId && !fixed, queryFn: () => api<CompRow[]>(`/employees/${empId}/compensation`) });
  const preview = useQuery({
    queryKey: ["payroll-preview", tplId, grossPaise], enabled: !!tplId && grossPaise > 0, retry: false,
    queryFn: () => api<{ lines: Line[] | { earnings?: Line[] } }>(`/payroll/preview?gross=${grossPaise}&templateId=${tplId}`),
  });
  const save = useMutation({
    mutationFn: () => api(`/employees/${empId}/compensation`, { body: { effectiveFrom: from, monthlyGrossPaise: grossPaise, templateId: tplId, reason } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["compensation", empId] }); qc.invalidateQueries({ queryKey: ["comp", empId] }); setReason(""); },
  });
  const raw = preview.data?.lines;
  const lines: Line[] = Array.isArray(raw) ? raw : raw?.earnings ?? [];
  return (
    <>
      <Card>
        <h2>{fixed ? "Change compensation" : "Compensation set-up"}</h2>
        {fixed && <p className="k">Records a new salary from the effective date. Earlier records stay in the history, and payroll uses the latest one effective for each month.</p>}
        {!fixed && <ErrorNote error={emps.error} />}<ErrorNote error={tpls.error} />
        {tpls.data?.length === 0 && <p className="k">No salary templates yet. Add one under Payroll &gt; Salary templates first.</p>}
        <div className="grid">
          {!fixed && <Field label="Employee"><select value={picked} onChange={(e) => setPicked(e.target.value)}><option value="">Select</option>{(emps.data?.employees ?? []).map((e) => <option key={e.id} value={e.id}>{e.fullName} ({e.code})</option>)}</select></Field>}
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
      {empId && !fixed && (
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
