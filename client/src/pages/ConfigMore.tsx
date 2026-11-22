import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Card, ErrorNote, Field } from "../lib/ui";
import { RulesTab as StatutoryRules, Templates as SalaryTemplates } from "./Payroll";
import { PolicyTab as ReimbursementPolicy } from "./Reimbursements";
import { Rules as FnfRules } from "./FullFinal";
import { Types as LeaveTypes } from "./Leave";
import { CalendarSettings, Holidays } from "./Attendance";
import { CANDIDATE_STEPS, KIND_LABEL, type ChecklistItem, type ChecklistKind } from "../../../shared/hr/onboardingChecklist";
import { fillEmail } from "../../../shared/hr/emailTemplates";
import { PLACEHOLDERS, placeholdersIn } from "../../../shared/hr/placeholders";

type Roles = { hr: boolean; fin: boolean };
const Section = ({ title, desc, children }: { title: string; desc: string; children: ReactNode }) =>
  <section className="cfg-section"><div className="cfg-section-head"><h2>{title}</h2><p className="k">{desc}</p></div>{children}</section>;

/** Pay settings, using the same editors as the Payroll, Reimbursements and Full and final pages. */
export function PayTab({ roles }: { roles: Roles }) {
  return <>
    <Section title="Statutory rules" desc="PF, TDS slabs, professional tax and the date they apply from. Used by every payroll run."><StatutoryRules /></Section>
    <Section title="Salary structures" desc="Templates that split CTC into components for new offers and compensation."><SalaryTemplates /></Section>
    <Section title="Reimbursement policy" desc="Mileage rates, bill and approval thresholds and the submission window."><ReimbursementPolicy canEdit={roles.hr || roles.fin} /></Section>
    {roles.hr ? <Section title="Full and final rules" desc="Notice recovery, leave encashment and gratuity settings for exits."><FnfRules /></Section>
      : <Section title="Full and final rules" desc="Only HR admin can change these."><Card><p className="k">Ask HR admin to update full and final rules.</p></Card></Section>}
  </>;
}

/** Time-off settings, using the same editors as the Leave and Attendance pages. HR admin only. */
export function TimeTab({ roles }: { roles: Roles }) {
  if (!roles.hr) return <Card><h2>Time off</h2><p className="k">Leave types, the work week and holidays are managed by HR admin.</p></Card>;
  return <>
    <Section title="Leave types and quotas" desc="Yearly quota, carry forward, accrual and whether a note is needed."><LeaveTypes /></Section>
    <Section title="Work week" desc="Working days, office hours and the attendance rules."><CalendarSettings /></Section>
    <Section title="Holidays" desc="The holiday calendar for each year."><Holidays /></Section>
  </>;
}

// ---------------------------------------------------------------- onboarding checklist
type OnbResp = { current: { version: number; items: ChecklistItem[]; updatedBy: string | null; updatedAt: string | null }; history: { version: number; by: string; at: string; count: number }[]; policies: { slug: string; title: string }[]; canEdit: boolean };
const KINDS: ChecklistKind[] = ["candidate_step", "document", "nda", "policy_ack", "asset", "custom"];
const newId = () => Math.random().toString(36).slice(2, 10);

export function OnboardingTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["config-onboarding"], queryFn: () => api<OnbResp>("/config/onboarding") });
  const [items, setItems] = useState<ChecklistItem[]>([]);
  useEffect(() => { if (q.data) setItems(q.data.current.items.map((i) => ({ ...i }))); }, [q.data]);
  const save = useMutation({ mutationFn: () => api<{ version: number; changed: boolean }>("/config/onboarding", { method: "PUT", body: { items } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["config-onboarding"] }) });
  if (q.error) return <ErrorNote error={q.error} />;
  if (!q.data) return <Card><p className="k">Loading…</p></Card>;
  const d = q.data, edit = d.canEdit;
  const dirty = JSON.stringify(items) !== JSON.stringify(d.current.items);
  const unnamed = items.filter((i) => !i.label.trim()).length;
  const set = (i: number, p: Partial<ChecklistItem>) => setItems(items.map((x, n) => (n === i ? { ...x, ...p } : x)));
  const move = (i: number, by: number) => { const j = i + by; if (j < 0 || j >= items.length) return; const n = [...items]; [n[i], n[j]] = [n[j], n[i]]; setItems(n); };
  const add = (kind: ChecklistKind) => setItems([...items, { id: `${kind}-${newId()}`, kind, label: kind === "nda" ? "Non-disclosure agreement signed" : kind === "policy_ack" ? d.policies[0]?.title ?? "" : kind === "candidate_step" ? CANDIDATE_STEPS.find((s) => !items.some((i) => i.key === s.key))?.label ?? "" : "", key: kind === "candidate_step" ? CANDIDATE_STEPS.find((s) => !items.some((i) => i.key === s.key))?.key ?? null : kind === "policy_ack" ? d.policies[0]?.slug ?? null : null, required: true }]);
  return <>
    <Card>
      <div className="cfg-card-head"><div><h2>Default onboarding checklist</h2>
        <p className="k">{d.current.updatedBy ? `Version ${d.current.version}, saved by ${d.current.updatedBy} on ${new Date(d.current.updatedAt!).toLocaleDateString("en-IN")}.` : "Not saved yet; the starting list is shown."} Each new onboarding link copies the current version, so links already sent are not affected.</p></div></div>
      <div className="cfg-table-wrap"><table className="cfg-table cfg-onb">
        <thead><tr><th>Type</th><th>Item</th><th>Details</th><th>Required</th><th /></tr></thead>
        <tbody>{items.map((it, i) => <tr key={it.id}>
          <td><select aria-label="Type" disabled={!edit} value={it.kind} onChange={(e) => set(i, { kind: e.target.value as ChecklistKind, key: null })}>{KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></td>
          <td><input aria-label="Item" disabled={!edit} value={it.label} placeholder="What needs doing" onChange={(e) => set(i, { label: e.target.value })} /></td>
          <td>{it.kind === "candidate_step" ? <select aria-label="Candidate step" disabled={!edit} value={it.key ?? ""} onChange={(e) => set(i, { key: e.target.value, label: it.label || CANDIDATE_STEPS.find((s) => s.key === e.target.value)?.label || "" })}>{CANDIDATE_STEPS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
            : it.kind === "policy_ack" ? <select aria-label="Policy" disabled={!edit} value={it.key ?? ""} onChange={(e) => set(i, { key: e.target.value, label: it.label || d.policies.find((p) => p.slug === e.target.value)?.title || "" })}><option value="">Choose a published policy</option>{d.policies.map((p) => <option key={p.slug} value={p.slug}>{p.title}</option>)}</select>
            : <span className="k">{it.kind === "document" ? "HR collects and checks" : it.kind === "asset" ? "Issued on day one" : it.kind === "nda" ? "Signed before joining" : "HR ticks when done"}</span>}</td>
          <td><input type="checkbox" aria-label="Required" disabled={!edit} checked={it.required} onChange={(e) => set(i, { required: e.target.checked })} /></td>
          <td className="cfg-row-acts">{edit && <><button type="button" className="cp-more" aria-label="Move up" onClick={() => move(i, -1)}>↑</button><button type="button" className="cp-more" aria-label="Move down" onClick={() => move(i, 1)}>↓</button><button type="button" className="cp-more" aria-label={`Remove ${it.label}`} onClick={() => setItems(items.filter((_, n) => n !== i))}>×</button></>}</td>
        </tr>)}</tbody>
      </table></div>
      {edit && <div className="cfg-addrow"><span className="k">Add:</span>{KINDS.map((k) => <button key={k} type="button" className="cp-link" onClick={() => add(k)}>{KIND_LABEL[k]}</button>)}</div>}
      {save.error && <ErrorNote error={save.error} />}
      {edit ? <div className="form-actions">{unnamed > 0 && <span className="k cfg-bad">{unnamed} item{unnamed === 1 ? " needs" : "s need"} a name</span>}<button className="btn p" disabled={!dirty || unnamed > 0 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : `Save as version ${d.current.updatedBy ? d.current.version + 1 : 1}`}</button>
        <button className="btn" disabled={!dirty} onClick={() => setItems(d.current.items)}>Discard changes</button>{save.data && !dirty && <span className="k">{save.data.changed ? `Saved version ${save.data.version}` : "No changes"}</span>}</div>
        : <p className="k">Only HR admin can change the checklist.</p>}
    </Card>
    {d.history.length > 0 && <Card><h2>Versions</h2>
      <div className="cfg-table-wrap"><table className="cfg-table"><thead><tr><th>Version</th><th>Items</th><th>Saved by</th><th>Saved on</th></tr></thead>
        <tbody>{d.history.map((h) => <tr key={h.version + h.at}><td>{h.version}</td><td>{h.count}</td><td>{h.by}</td><td>{new Date(h.at).toLocaleString("en-IN")}</td></tr>)}</tbody></table></div></Card>}
  </>;
}

// ---------------------------------------------------------------- email templates
type Tpl = { key: string; label: string; when: string; vars: { key: string; label: string; example: string }[]; subject: string; body: string; customised: boolean; updatedAt: string | null; defaultSubject: string; defaultBody: string };
type Ph = { key: string; label: string; kind: string; value: unknown };

function TemplateEditor({ t, values, canEdit }: { t: Tpl; values: Record<string, string | null>; canEdit: boolean }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ subject: t.subject, body: t.body });
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setF({ subject: t.subject, body: t.body }), [t.subject, t.body]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["config-email"] });
  const save = useMutation({ mutationFn: () => api(`/config/email-templates/${t.key}`, { method: "PUT", body: f }), onSuccess: refresh });
  const reset = useMutation({ mutationFn: () => api(`/config/email-templates/${t.key}`, { method: "DELETE" }), onSuccess: refresh });
  const allowed = useMemo(() => new Set([...t.vars.map((v) => v.key), ...PLACEHOLDERS.filter((p) => p.kind === "text").map((p) => p.key)]), [t.vars]);
  const used = [...new Set([...placeholdersIn(f.subject), ...placeholdersIn(f.body)])];
  const unknown = used.filter((k) => !allowed.has(k)), missing = used.filter((k) => allowed.has(k) && !t.vars.some((v) => v.key === k) && !values[k]);
  const sample = { ...values, ...Object.fromEntries(t.vars.map((v) => [v.key, v.example])) };
  const dirty = f.subject !== t.subject || f.body !== t.body;
  const insert = (k: string) => { const el = ref.current, tok = `{{${k}}}`; if (!el) return setF({ ...f, body: f.body + tok }); const a = el.selectionStart, b = el.selectionEnd; setF({ ...f, body: f.body.slice(0, a) + tok + f.body.slice(b) }); requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + tok.length, a + tok.length); }); };
  return <Card>
    <div className="cfg-card-head"><div><h2>{t.label}</h2><p className="k">{t.when}. {t.customised ? `Edited ${t.updatedAt ? new Date(t.updatedAt).toLocaleDateString("en-IN") : ""}.` : "Using the default wording."}</p></div>{t.customised && <span className="cp-tag slate">Edited</span>}</div>
    <div className="cfg-editor">
      <div className="cfg-pane">
        <Field label="Subject"><input disabled={!canEdit} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></Field>
        <div className="cfg-pane-bar"><b>Body</b><select aria-label="Insert placeholder" disabled={!canEdit} value="" onChange={(e) => e.target.value && insert(e.target.value)}>
          <option value="">Insert placeholder…</option>
          <optgroup label="For this email">{t.vars.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}</optgroup>
          {[...new Set(PLACEHOLDERS.filter((p) => p.kind === "text").map((p) => p.group))].map((g) => <optgroup key={g} label={g}>{PLACEHOLDERS.filter((p) => p.kind === "text" && p.group === g).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</optgroup>)}
        </select></div>
        <textarea ref={ref} className="cfg-mail" aria-label={`${t.label} body`} disabled={!canEdit} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
      </div>
      <div className="cfg-pane">
        <div className="cfg-pane-bar"><b>Preview with sample values</b></div>
        <div className="cfg-mail-preview"><div className="cfg-mail-subj">{fillEmail(f.subject, sample)}</div><pre>{fillEmail(f.body, sample)}</pre></div>
        {unknown.length > 0 && <div className="cfg-missing"><b>Unknown placeholders</b><ul>{unknown.map((k) => <li key={k} className="cfg-bad"><code>{`{{${k}}}`}</code> is not allowed here. Use the Insert placeholder list.</li>)}</ul></div>}
        {missing.length > 0 && <div className="cfg-missing"><b>No value yet</b><ul>{missing.map((k) => <li key={k}>{PLACEHOLDERS.find((p) => p.key === k)?.label} <code>{`{{${k}}}`}</code> will be blank until it is set in Configuration.</li>)}</ul></div>}
        {!unknown.length && !missing.length && <p className="cfg-ok-line">All placeholders are known and have values.</p>}
      </div>
    </div>
    {(save.error ?? reset.error) && <ErrorNote error={save.error ?? reset.error} />}
    {canEdit && <div className="form-actions"><button className="btn p" disabled={!dirty || unknown.length > 0 || save.isPending} onClick={() => save.mutate()}>Save</button>
      <button className="btn" disabled={!dirty} onClick={() => setF({ subject: t.subject, body: t.body })}>Discard changes</button>
      {t.customised && <button className="btn" disabled={reset.isPending} onClick={() => reset.mutate()}>Reset to default</button>}</div>}
  </Card>;
}

export function TemplatesTab({ goConfig }: { goConfig: (t: string) => void }) {
  const q = useQuery({ queryKey: ["config-email"], queryFn: () => api<{ canEdit: boolean; templates: Tpl[] }>("/config/email-templates") });
  const ph = useQuery({ queryKey: ["config-placeholders"], queryFn: () => api<Ph[]>("/config/placeholders") });
  if (q.error) return <ErrorNote error={q.error} />;
  if (!q.data || !ph.data) return <Card><p className="k">Loading…</p></Card>;
  const values = Object.fromEntries(ph.data.map((p) => [p.key, typeof p.value === "string" ? p.value : null]));
  return <>
    <Card><h2>Letter defaults</h2><p className="k">Letters print the company details, signatory, signature and stamp set in the Company tab. Letter wording is chosen per letter type when a letter is written.</p>
      <div className="form-actions" style={{ marginTop: 8 }}><button className="btn sm" onClick={() => goConfig("company")}>Open Company details</button></div></Card>
    {q.data.templates.map((t) => <TemplateEditor key={t.key} t={t} values={values} canEdit={q.data!.canEdit} />)}
  </>;
}
