import { Fragment, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Card, ErrorNote, Field, Page } from "../lib/ui";
import { Company } from "./Letters";
import { Signatories } from "./Payroll";
import { PlaceholdersTab, PoliciesTab } from "./ConfigPolicies";
import { OnboardingTab, PayTab, TemplatesTab, TimeTab } from "./ConfigMore";
import type { Check, Committee, Gender, Person } from "../../../shared/hr/orgRoles";
import "./compliance.css";
import "./config.css";

type Emp = { id: string; name: string; email: string; phone: string | null; gender: string | null; designation: string | null };
type ContactKey = string;
type Resp = {
  today: string; committee: Committee; checks: Check[]; contacts: Record<ContactKey, Person | null>; contactRoles: { key: ContactKey; label: string; hint: string; kind: "person" | "mailbox" | "link" }[];
  people: Emp[]; companySet: boolean; canEditCompany: boolean; canViewCompany: boolean;
};
type Me = { roles: string[] };

const GENDERS: [Gender, string][] = [["female", "Woman"], ["male", "Man"], ["other", "Other"], ["undisclosed", "Not stated"]];
const blank = (): Person => ({ employeeId: null, name: "", email: null, phone: null, designation: null, organisation: null, gender: "undisclosed" });
const fromEmp = (e: Emp): Person => ({ employeeId: e.id, name: e.name, email: e.email, phone: null, designation: e.designation, organisation: null,
  gender: (["female", "male", "other"].includes((e.gender ?? "").toLowerCase()) ? (e.gender ?? "").toLowerCase() : "undisclosed") as Gender });
const clean = (p: Person | null) => (p && p.name.trim() ? { ...p, name: p.name.trim(), email: p.email?.trim() || null, phone: p.phone?.trim() || null, designation: p.designation?.trim() || null, organisation: p.organisation?.trim() || null } : null);

/** Picks an employee from People, or switches to typing in someone who is not on the rolls. */
function PersonPick({ value, people, onChange, allowTyped = true, label }: { value: Person | null; people: Emp[]; onChange: (p: Person | null) => void; allowTyped?: boolean; label: string }) {
  const typed = !!value && !value.employeeId;
  const sel = value?.employeeId ?? (typed ? "__typed" : "");
  return <div className="cfg-pick">
    <select aria-label={label} value={sel} onChange={(e) => { const v = e.target.value; onChange(v === "" ? null : v === "__typed" ? { ...blank(), name: value?.name ?? "" } : fromEmp(people.find((x) => x.id === v)!)); }}>
      <option value="">Not set</option>
      {people.map((e) => <option key={e.id} value={e.id}>{e.name}{e.designation ? ` (${e.designation})` : ""}</option>)}
      {allowTyped && <option value="__typed">Someone not in People…</option>}
    </select>
    {typed && <input aria-label={`${label} name`} placeholder="Full name" value={value!.name} onChange={(e) => onChange({ ...value!, name: e.target.value })} />}
  </div>;
}

function Checks({ checks }: { checks: Check[] }) {
  const done = checks.filter((c) => c.ok).length;
  return <div className="cfg-checks">
    <div className="cfg-checks-head"><b>Requirements</b><span className={`cp-tag ${done === checks.length ? "green" : "amber"}`}>{done} of {checks.length} met</span></div>
    <ul>{checks.map((c) => <li key={c.key} className={c.ok ? "cfg-met" : "cfg-unmet"}><i aria-hidden />{c.label}<span className="k">{c.detail}</span></li>)}</ul>
    <p className="k">Section 4 of the POSH Act, 2013. Saved changes are logged in the audit log.</p>
  </div>;
}

function PoshCommittee({ d }: { d: Resp }) {
  const qc = useQueryClient();
  const [c, setC] = useState<Committee>(d.committee);
  useEffect(() => setC(d.committee), [d.committee]);
  const save = useMutation({
    mutationFn: () => api("/config/posh-committee", { method: "PUT", body: { presiding: clean(c.presiding), members: c.members.map(clean).filter(Boolean), external: clean(c.external), termStart: c.termStart || null, termEnd: c.termEnd || null } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["config"] }),
  });
  const setMember = (i: number, p: Person | null) => setC({ ...c, members: p ? c.members.map((m, j) => (j === i ? p : m)) : c.members.filter((_, j) => j !== i) });
  const row = (role: string, p: Person | null, set: (p: Person | null) => void, opts: { typedOnly?: boolean; employeeOnly?: boolean; removable?: boolean } = {}) =>
    <tr>
      <td className="cfg-role">{role}</td>
      <td><div className="cfg-pick">{opts.typedOnly
        ? <input aria-label={`${role} name`} placeholder="Full name" value={p?.name ?? ""} onChange={(e) => set({ ...(p ?? blank()), name: e.target.value })} />
        : <PersonPick label={role} value={p} people={d.people} onChange={set} allowTyped={!opts.employeeOnly} />}
        {p && !p.employeeId || opts.typedOnly
          ? <input aria-label={`${role} email`} placeholder="Email" value={p?.email ?? ""} onChange={(e) => set({ ...(p ?? blank()), email: e.target.value })} />
          : p?.email ? <span className="k">{p.email}</span> : null}</div></td>
      <td>{opts.typedOnly
        ? <input aria-label={`${role} organisation`} placeholder="NGO or organisation" value={p?.organisation ?? ""} onChange={(e) => set({ ...(p ?? blank()), organisation: e.target.value })} />
        : <input aria-label={`${role} designation`} placeholder="Designation" value={p?.designation ?? ""} disabled={!p} onChange={(e) => set({ ...p!, designation: e.target.value })} />}</td>
      <td><select aria-label={`${role} gender`} value={p?.gender ?? "undisclosed"} disabled={!p && !opts.typedOnly} onChange={(e) => set({ ...(p ?? blank()), gender: e.target.value as Gender })}>{GENDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
      <td className="cfg-x">{opts.removable && <button type="button" className="cp-more" aria-label={`Remove ${p?.name || "member"}`} onClick={() => set(null)}>×</button>}</td>
    </tr>;
  return <Card>
    <div className="cfg-card-head"><div><h2>POSH Internal Committee</h2><p className="k">Members are shown on the committee order in Compliance and, from phase 2, in the POSH policy.</p></div></div>
    <div className="cfg-split">
      <div className="cfg-main">
        <div className="form-row">
          <Field label="Term starts"><input type="date" value={c.termStart ?? ""} onChange={(e) => setC({ ...c, termStart: e.target.value || null })} /></Field>
          <Field label="Term ends (up to 3 years)"><input type="date" value={c.termEnd ?? ""} onChange={(e) => setC({ ...c, termEnd: e.target.value || null })} /></Field>
        </div>
        <div className="cfg-table-wrap"><table className="cfg-table cfg-committee">
          <thead><tr><th>Seat</th><th>Person</th><th>Designation or organisation</th><th>Gender</th><th /></tr></thead>
          <tbody>
            {row("Presiding officer", c.presiding, (p) => setC({ ...c, presiding: p }), { employeeOnly: true })}
            {c.members.map((m, i) => <Fragment key={i}>{row(`Member ${i + 1}`, m, (p) => setMember(i, p), { removable: true })}</Fragment>)}
            {row("External member", c.external, (p) => setC({ ...c, external: p }), { typedOnly: true })}
          </tbody>
        </table></div>
        <button type="button" className="cp-link cfg-add" onClick={() => setC({ ...c, members: [...c.members, blank()] })}>Add member</button>
        {save.error && <ErrorNote error={save.error} />}
        <div className="form-actions">
          <button className="btn p" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save committee"}</button>
          <button className="btn" disabled={save.isPending} onClick={() => setC(d.committee)}>Discard changes</button>
          {save.isSuccess && <span className="k">Saved</span>}
        </div>
      </div>
      <Checks checks={d.checks} />
    </div>
  </Card>;
}

function Contacts({ d }: { d: Resp }) {
  const qc = useQueryClient();
  const [c, setC] = useState(d.contacts);
  useEffect(() => setC(d.contacts), [d.contacts]);
  const save = useMutation({ mutationFn: () => api("/config/contacts", { method: "PUT", body: Object.fromEntries(d.contactRoles.map((r) => [r.key, clean(c[r.key])])) }), onSuccess: () => qc.invalidateQueries({ queryKey: ["config"] }) });
  return <Card>
    <div className="cfg-card-head"><div><h2>Named contacts</h2><p className="k">One person or address for each role. Pick from People or type in someone outside the company. Policies use these through fields such as "Ethics officer" and "Internal Committee email".</p></div></div>
    <div className="cfg-table-wrap"><table className="cfg-table cfg-contacts">
      <thead><tr><th>Role</th><th>Person</th><th>Email</th><th>Phone</th></tr></thead>
      <tbody>{d.contactRoles.map((r) => { const p = c[r.key] ?? null; const set = (x: Person | null) => setC({ ...c, [r.key]: x });
        // A mailbox is just an address and a form is just a link; they are stored without a person.
        if (r.kind !== "person") return <tr key={r.key}>
          <td className="cfg-role">{r.label}<span className="k">{r.hint}</span></td>
          <td colSpan={3}>{r.kind === "mailbox"
            ? <input type="email" aria-label={`${r.label} address`} placeholder="name@company.com" value={p?.email ?? ""} onChange={(e) => set(e.target.value.trim() ? { ...blank(), ...(p ?? {}), employeeId: null, name: r.label, email: e.target.value } : null)} />
            : <input type="url" aria-label={`${r.label} link`} placeholder="https://…" value={p?.organisation ?? ""} onChange={(e) => set(e.target.value.trim() ? { ...blank(), ...(p ?? {}), employeeId: null, name: r.label, organisation: e.target.value } : null)} />}</td>
        </tr>;
        return <tr key={r.key}>
        <td className="cfg-role">{r.label}<span className="k">{r.hint}</span></td>
        <td><PersonPick label={r.label} value={p} people={d.people} onChange={set} /></td>
        <td>{p && !p.employeeId ? <input aria-label={`${r.label} email`} placeholder="Email" value={p.email ?? ""} onChange={(e) => set({ ...p, email: e.target.value })} /> : <span className="k">{p?.email ?? ""}</span>}</td>
        <td><input aria-label={`${r.label} phone`} placeholder="Optional" value={p?.phone ?? ""} disabled={!p} onChange={(e) => set({ ...p!, phone: e.target.value })} /></td>
      </tr>; })}</tbody>
    </table></div>
    {save.error && <ErrorNote error={save.error} />}
    <div className="form-actions"><button className="btn p" disabled={save.isPending} onClick={() => save.mutate()}>Save contacts</button>{save.isSuccess && <span className="k">Saved</span>}</div>
  </Card>;
}

type Summary = { pay: { rulesFrom: string | null; salaryTemplates: number; reimbursementSet: boolean; fnfSet: boolean }; time: { leaveTypes: number; holidaysThisYear: number; year: string };
  onboarding: { version: number; items: number }; templates: { total: number; customised: number }; policies: { published: number; waiting: number; drafts: number }; canEditTime: boolean; canEditHr: boolean };
type Tone = "green" | "amber" | "slate";
type Section = { key: string; name: string; desc: string; status: { tone: Tone; text: string }; to: string };
function Overview({ d, s, go }: { d: Resp; s: Summary | undefined; go: (t: string) => void }) {
  const met = d.checks.filter((c) => c.ok).length, contacts = d.contactRoles.filter((r) => d.contacts[r.key]).length;
  const st = (ok: boolean, good: string, bad: string): { tone: Tone; text: string } => (ok ? { tone: "green", text: good } : { tone: "amber", text: bad });
  const payMissing = s ? [!s.pay.rulesFrom && "statutory rules", !s.pay.salaryTemplates && "salary structure", !s.pay.reimbursementSet && "reimbursement policy"].filter(Boolean) as string[] : [];
  const sections: Section[] = [
    { key: "company", name: "Company", desc: "Legal name, CIN, registered address and the signatory printed on letters and policies.", status: st(d.companySet, "Set", "Using defaults"), to: "company" },
    { key: "people", name: "POSH Internal Committee", desc: "Presiding officer, employee members, external member and term.", status: st(met === d.checks.length, "Complete", `${met} of ${d.checks.length} requirements met`), to: "people" },
    { key: "contacts", name: "Named contacts", desc: "Grievance officer, data protection officer and HR contact.", status: st(contacts === d.contactRoles.length, "Complete", `${contacts} of ${d.contactRoles.length} set`), to: "people" },
    { key: "policies", name: "Policies", desc: "Policy templates with placeholders, CEO approval, reminders and version comparison.",
      status: !s ? { tone: "slate", text: "…" } : s.policies.waiting ? { tone: "amber", text: `${s.policies.waiting} waiting for CEO approval` } : { tone: s.policies.published ? "green" : "amber", text: `${s.policies.published} published${s.policies.drafts ? `, ${s.policies.drafts} in progress` : ""}` }, to: "policies" },
    { key: "placeholders", name: "Placeholders", desc: "Every value policies and emails can use, its current value and where it is used.", status: { tone: "slate", text: "Reference" }, to: "placeholders" },
    { key: "pay", name: "Pay and money", desc: "Statutory rules, salary structures, reimbursement policy and full and final rules.",
      status: !s ? { tone: "slate", text: "…" } : payMissing.length ? { tone: "amber", text: `${3 - payMissing.length} of 3 set up; add ${payMissing[0]}` } : { tone: "green", text: `Rules from ${s.pay.rulesFrom}, ${s.pay.salaryTemplates} structure${s.pay.salaryTemplates === 1 ? "" : "s"}` }, to: "pay" },
    { key: "time", name: "Time off", desc: "Leave types and quotas, the work week and the holiday calendar.",
      status: !s ? { tone: "slate", text: "…" } : st(s.time.leaveTypes > 0 && s.time.holidaysThisYear > 0, `${s.time.leaveTypes} leave types, ${s.time.holidaysThisYear} holidays in ${s.time.year}`, `${s.time.leaveTypes} leave types, ${s.time.holidaysThisYear} holidays in ${s.time.year}`), to: "time" },
    { key: "onboarding", name: "Onboarding checklist", desc: "Default documents, NDA, policy acknowledgements and assets copied into every new onboarding link.",
      status: !s ? { tone: "slate", text: "…" } : s.onboarding.version ? { tone: "green", text: `Version ${s.onboarding.version}, ${s.onboarding.items} items` } : { tone: "amber", text: "Using the starting list" }, to: "onboarding" },
    { key: "templates", name: "Letter and email templates", desc: "Email wording for offer, onboarding and reminder emails, and letter defaults.",
      status: !s ? { tone: "slate", text: "…" } : { tone: "green", text: s.templates.customised ? `${s.templates.customised} of ${s.templates.total} edited` : `${s.templates.total} templates, default wording` }, to: "templates" },
  ];
  return <div className="cfg-list">
    <div className="cfg-list-row cfg-list-head" aria-hidden><span>Section</span><span>Status</span><span /></div>
    {sections.map((x) => <div key={x.key} className="cfg-list-row">
      <span><b>{x.name}</b><span className="k">{x.desc}</span></span>
      <span><span className={`cp-tag ${x.status.tone}`} title={x.status.text}>{x.status.text}</span></span>
      <span className="cfg-go"><button type="button" className="btn sm" onClick={() => go(x.to)}>Open</button></span>
    </div>)}
  </div>;
}

export default function Config() {
  const q = useQuery({ queryKey: ["config"], queryFn: () => api<Resp>("/config") });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get("tab") ?? "overview");
  const summary = useQuery({ queryKey: ["config-summary"], queryFn: () => api<Summary>("/config/summary") });
  const roles = new Set(me.data?.roles ?? []);
  const r = { hr: roles.has("hr_admin"), fin: roles.has("finance_signatory") };
  const tabs: [string, string][] = [["overview", "Overview"], ["company", "Company"], ["people", "People and committees"], ["policies", "Policies"], ["placeholders", "Placeholders"],
    ["pay", "Pay and money"], ["time", "Time off"], ["onboarding", "Onboarding"], ["templates", "Templates"]];
  return <Page title="Configuration">
    <div className="tabs cp-tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
    <div className="cp cfg">
      {q.error ? <ErrorNote error={q.error} /> : !q.data ? <Card><p className="k">Loading…</p></Card> : <>
        {tab === "overview" && <Overview d={q.data} s={summary.data} go={setTab} />}
        {tab === "company" && <>
          {q.data.canViewCompany ? <Company ceo={q.data.canEditCompany} /> : <Card><h2>Company details</h2><p className="k">Only HR admin and the CEO can view the company details printed on letters.</p></Card>}
          <Signatories isHr={roles.has("hr_admin")} isFin={roles.has("finance_signatory")} />
        </>}
        {tab === "people" && <><PoshCommittee d={q.data} /><Contacts d={q.data} /></>}
        {tab === "policies" && <PoliciesTab goConfig={setTab} />}
        {tab === "placeholders" && <PlaceholdersTab />}
        {tab === "pay" && <PayTab roles={r} />}
        {tab === "time" && <TimeTab roles={r} />}
        {tab === "onboarding" && <OnboardingTab />}
        {tab === "templates" && <TemplatesTab goConfig={setTab} />}
      </>}
    </div>
  </Page>;
}
