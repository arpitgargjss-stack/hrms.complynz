import { useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fileToBase64 } from "../lib/api";
import { openAuthed } from "../lib/openHtml";
import { Card, Chip, ErrorNote, Field, Page, inr } from "../lib/ui";

type Me = { email: string; employeeId: string | null; roles: string[] };
type Dir = { id: string; code: string; fullName: string; designation: string | null; department: string | null; workEmail: string; status?: string; managerId: string | null };
type Detail = Dir & {
  access: string; location?: string | null; joiningDate?: string; employmentType?: string; lastWorkingDay?: string | null;
  phone?: string | null; personalEmail?: string | null; dob?: string | null; gender?: string | null;
  panMasked?: string | null; accountMasked?: string | null; bankName?: string | null; ifsc?: string | null;
};
type Doc = { id: string; kind: string; name: string; mime: string; sizeBytes: number; createdAt: string };
type Comp = { id: string; effectiveFrom: string; monthlyGrossPaise: number; reason: string | null };
type MgrChange = { id: string; fromManagerId: string | null; toManagerId: string | null; effectiveFrom: string; reason: string | null; changedBy: string };
type EmpAsset = { assignmentId: string; issuedOn: string; returnedOn: string | null; current: boolean; asset: { tag: string; category: string; model: string | null } };
type Named = { id: string; name: string };
const today = () => new Date().toISOString().slice(0, 10);
const KIND: Record<string, string> = { pan: "PAN", aadhaar: "Aadhaar", photo: "Photo" };

function List({ admin }: { admin: boolean }) {
  const [, nav] = useLocation();
  const [qstr, setQstr] = useState("");
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ["employees"], queryFn: () => api<{ scope: string; employees: Dir[] }>("/employees") });
  const rows = (q.data?.employees ?? []).filter((e) => `${e.fullName} ${e.code} ${e.workEmail} ${e.department ?? ""} ${e.designation ?? ""}`.toLowerCase().includes(qstr.toLowerCase()));
  return (
    <Page title="People" actions={admin && <button className="btn p" aria-expanded={adding} onClick={() => setAdding(!adding)}>Add employee</button>}>
      {adding && <AddEmployee onDone={(id) => { setAdding(false); nav(`/people/${id}`); }} />}
      <Card>
        <Field label="Search by name, code, email or department"><input type="search" value={qstr} onChange={(e) => setQstr(e.target.value)} /></Field>
        <ErrorNote error={q.error} />
        {q.isLoading && <p>Loading…</p>}
        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table className="t"><caption className="k" style={{ textAlign: "left" }}>{rows.length} {rows.length === 1 ? "person" : "people"}</caption>
            <thead><tr><th scope="col">Name</th><th scope="col">Code</th><th scope="col">Role</th><th scope="col">Department</th><th scope="col">Status</th></tr></thead>
            <tbody>{rows.map((e) => (
              <tr key={e.id}><td><Link href={`/people/${e.id}`}>{e.fullName}</Link><span className="k" style={{ display: "block" }}>{e.workEmail}</span></td>
                <td>{e.code}</td><td>{e.designation}</td><td>{e.department}</td>
                <td>{e.status && <Chip tone={e.status === "active" ? "ok" : e.status === "notice" ? "warn" : "mute"}>{e.status}</Chip>}</td></tr>))}</tbody></table>
        </div>
      </Card>
    </Page>
  );
}

function useRefs() {
  const d = useQuery({ queryKey: ["departments"], queryFn: () => api<Named[]>("/departments") });
  const g = useQuery({ queryKey: ["designations"], queryFn: () => api<Named[]>("/designations") });
  const l = useQuery({ queryKey: ["locations"], queryFn: () => api<Named[]>("/locations") });
  return { d: d.data ?? [], g: g.data ?? [], l: l.data ?? [] };
}
const Sel = ({ label, value, onChange, opts }: { label: string; value: string; onChange: (v: string) => void; opts: Named[] }) => (
  <Field label={label}><select value={value} onChange={(e) => onChange(e.target.value)}><option value="">None</option>{opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>);

function AddEmployee({ onDone }: { onDone: (id: string) => void }) {
  const qc = useQueryClient();
  const refs = useRefs();
  const emps = useQuery({ queryKey: ["employees"], queryFn: () => api<{ employees: Dir[] }>("/employees") });
  const [f, setF] = useState({ fullName: "", workEmail: "", personalEmail: "", phone: "", dob: "", gender: "", joiningDate: today(), departmentId: "", designationId: "", locationId: "", managerId: "", employmentType: "full_time", pan: "", bankName: "", accountNumber: "", ifsc: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const m = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { fullName: f.fullName, workEmail: f.workEmail, joiningDate: f.joiningDate, employmentType: f.employmentType };
      for (const k of ["personalEmail", "phone", "dob", "gender", "departmentId", "designationId", "locationId", "managerId", "pan", "bankName", "accountNumber", "ifsc"] as const) if (f[k]) body[k] = f[k];
      return api<{ id: string }>("/employees", { method: "POST", body });
    },
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["employees"] }); qc.invalidateQueries({ queryKey: ["org-chart"] }); onDone(r.id); },
  });
  return (
    <Card>
      <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <h2>Add employee</h2>
        <div className="grid">
          <Field label="Full name"><input required value={f.fullName} onChange={set("fullName")} /></Field>
          <Field label="Work email"><input type="email" required value={f.workEmail} onChange={set("workEmail")} /></Field>
          <Field label="Personal email"><input type="email" value={f.personalEmail} onChange={set("personalEmail")} /></Field>
          <Field label="Phone"><input type="tel" value={f.phone} onChange={set("phone")} /></Field>
          <Field label="Date of birth"><input type="date" value={f.dob} onChange={set("dob")} /></Field>
          <Field label="Gender"><select value={f.gender} onChange={set("gender")}><option value="">Not stated</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option><option value="undisclosed">Prefer not to say</option></select></Field>
          <Field label="Date of joining"><input type="date" required value={f.joiningDate} onChange={set("joiningDate")} /></Field>
          <Field label="Employment type"><select value={f.employmentType} onChange={set("employmentType")}><option value="full_time">Full-time</option><option value="part_time">Part-time</option><option value="contract">Contract</option><option value="intern">Intern</option></select></Field>
          <Sel label="Department" value={f.departmentId} onChange={(v) => setF({ ...f, departmentId: v })} opts={refs.d} />
          <Sel label="Designation" value={f.designationId} onChange={(v) => setF({ ...f, designationId: v })} opts={refs.g} />
          <Sel label="Location" value={f.locationId} onChange={(v) => setF({ ...f, locationId: v })} opts={refs.l} />
          <Sel label="Reports to" value={f.managerId} onChange={(v) => setF({ ...f, managerId: v })} opts={(emps.data?.employees ?? []).map((e) => ({ id: e.id, name: e.fullName }))} />
        </div>
        <details style={{ marginTop: 12 }}><summary>PAN and bank details (optional, stored encrypted, shown masked)</summary>
          <div className="grid">
            <Field label="PAN"><input value={f.pan} onChange={(e) => setF({ ...f, pan: e.target.value.toUpperCase() })} autoComplete="off" /></Field>
            <Field label="Bank name"><input value={f.bankName} onChange={set("bankName")} /></Field>
            <Field label="Account number"><input inputMode="numeric" value={f.accountNumber} onChange={set("accountNumber")} autoComplete="off" /></Field>
            <Field label="IFSC"><input value={f.ifsc} onChange={(e) => setF({ ...f, ifsc: e.target.value.toUpperCase() })} /></Field>
          </div></details>
        <ErrorNote error={m.error} />
        <p><button className="btn p" disabled={m.isPending}>Create employee</button></p>
      </form>
    </Card>
  );
}

function Documents({ id, canUpload }: { id: string; canUpload: boolean }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState("pan");
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const docs = useQuery({ queryKey: ["docs", id], queryFn: () => api<Doc[]>(`/employees/${id}/documents`) });
  const up = useMutation({
    mutationFn: async () => api(`/employees/${id}/documents`, { method: "POST", body: { kind, name: file!.name, mime: file!.type, dataBase64: await fileToBase64(file!) } }),
    onSuccess: () => { setFile(null); qc.invalidateQueries({ queryKey: ["docs", id] }); qc.invalidateQueries({ queryKey: ["employee", id] }); },
  });
  return (
    <Card>
      <h2>Documents</h2>
      <p className="k">PAN, Aadhaar and photo. PDF, PNG, JPEG or WebP up to 10 MB. Every view of an ID document is logged.</p>
      <ErrorNote error={docs.error ?? err} />
      {docs.data?.length === 0 && <p className="k">No documents uploaded.</p>}
      {docs.data?.map((d) => (
        <div key={d.id} className="row-gap" style={{ justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderTop: "1px solid #eceef4" }}>
          <span><Chip tone="info">{KIND[d.kind] ?? d.kind}</Chip> {d.name} <span className="k">{Math.ceil(d.sizeBytes / 1024)} KB · {new Date(d.createdAt).toLocaleDateString("en-IN")}</span></span>
          <button className="btn" aria-label={`View ${KIND[d.kind] ?? d.kind} document ${d.name}`} onClick={() => openAuthed(`/files/${d.id}`).catch(setErr)}>View</button>
        </div>))}
      {canUpload && (
        <form onSubmit={(e) => { e.preventDefault(); if (file) up.mutate(); }} style={{ marginTop: 12 }}>
          <div className="grid">
            <Field label="Document type"><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="pan">PAN</option><option value="aadhaar">Aadhaar</option><option value="photo">Photo</option></select></Field>
            <Field label="File"><input type="file" required accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
          </div>
          <ErrorNote error={up.error} />
          <p><button className="btn p" disabled={!file || up.isPending}>Upload</button></p>
        </form>)}
    </Card>
  );
}

function ManagerCard({ id, current, names }: { id: string; current: string | null; names: Map<string, string> }) {
  const qc = useQueryClient();
  const all = useQuery({ queryKey: ["employees"], queryFn: () => api<{ employees: Dir[] }>("/employees") });
  const hist = useQuery({ queryKey: ["mgr-hist", id], queryFn: () => api<MgrChange[]>(`/employees/${id}/manager-history`) });
  const [f, setF] = useState({ managerId: "", effectiveFrom: today(), reason: "" });
  const m = useMutation({
    mutationFn: () => api(`/employees/${id}/manager`, { method: "POST", body: { managerId: f.managerId || null, effectiveFrom: f.effectiveFrom, reason: f.reason } }),
    onSuccess: () => { setF({ ...f, reason: "" }); for (const k of ["employee", "mgr-hist", "employees", "org-chart"]) qc.invalidateQueries({ queryKey: [k] }); },
  });
  return (
    <Card>
      <h2>Change reporting manager</h2>
      <p className="k">Currently reports to {current ? names.get(current) ?? "unknown" : "nobody"}. The change is recorded with its date and reason.</p>
      <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        <div className="grid">
          <Field label="New manager"><select value={f.managerId} onChange={(e) => setF({ ...f, managerId: e.target.value })}><option value="">No manager</option>{(all.data?.employees ?? []).filter((e) => e.id !== id).map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}</select></Field>
          <Field label="Effective from"><input type="date" required value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} /></Field>
          <Field label="Reason"><input required maxLength={500} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        </div>
        <ErrorNote error={m.error} />
        <p><button className="btn p" disabled={m.isPending}>Change manager</button></p>
      </form>
      {hist.data?.map((h) => (
        <div key={h.id} className="k" style={{ padding: "6px 0", borderTop: "1px solid #eceef4" }}>
          {h.effectiveFrom}: {h.fromManagerId ? names.get(h.fromManagerId) ?? "unknown" : "nobody"} to {h.toManagerId ? names.get(h.toManagerId) ?? "unknown" : "nobody"} · {h.reason} · by {h.changedBy}
        </div>))}
    </Card>
  );
}

function Detail({ id, admin, myId }: { id: string; admin: boolean; myId: string | null }) {
  const e = useQuery({ queryKey: ["employee", id], queryFn: () => api<Detail>(`/employees/${id}`) });
  const all = useQuery({ queryKey: ["employees"], queryFn: () => api<{ employees: Dir[] }>("/employees") });
  const assets = useQuery({ queryKey: ["emp-assets", id], enabled: admin || myId === id, queryFn: () => api<EmpAsset[]>(`/employees/${id}/assets`) });
  const comp = useQuery({ queryKey: ["comp", id], enabled: admin, queryFn: () => api<Comp[]>(`/employees/${id}/compensation`) });
  const names = new Map((all.data?.employees ?? []).map((x) => [x.id, x.fullName]));
  const d = e.data;
  const own = myId === id;
  const rows: [string, string | null | undefined][] = d ? [
    ["Employee code", d.code], ["Work email", d.workEmail], ["Date of joining", d.joiningDate], ["Employment type", d.employmentType?.replace("_", " ")], ["Location", d.location],
    ["Reports to", d.managerId ? names.get(d.managerId) ?? "…" : null], ["Last working day", d.lastWorkingDay],
    ["Phone", d.phone], ["Personal email", d.personalEmail], ["Date of birth", d.dob], ["Gender", d.gender],
  ] : [];
  return (
    <Page title={d?.fullName ?? "Person"} actions={<Link href="/people" className="btn" style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>All people</Link>}>
      <ErrorNote error={e.error} />
      {e.isLoading && <p>Loading…</p>}
      {d && (
        <>
          <Card>
            <p className="k">{[d.designation, d.department].filter(Boolean).join(" · ")} {d.status && <Chip tone={d.status === "active" ? "ok" : "warn"}>{d.status}</Chip>}</p>
            {d.access === "directory" && <div className="note info">You can see the directory card only. Other details are visible to this person's manager and HR.</div>}
            <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, margin: 0 }}>
              {rows.filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="k">{k}</dt><dd style={{ margin: 0 }}>{v}</dd></div>)}
            </dl>
          </Card>
          {(d.panMasked || d.accountMasked || d.ifsc) && (
            <Card><h2>ID and bank</h2>
              <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, margin: 0 }}>
                <div><dt className="k">PAN</dt><dd style={{ margin: 0 }}>{d.panMasked ?? "Not provided"}</dd></div>
                <div><dt className="k">Bank</dt><dd style={{ margin: 0 }}>{d.bankName ?? "Not provided"}</dd></div>
                <div><dt className="k">Account number</dt><dd style={{ margin: 0 }}>{d.accountMasked ?? "Not provided"}</dd></div>
                <div><dt className="k">IFSC</dt><dd style={{ margin: 0 }}>{d.ifsc ?? "Not provided"}</dd></div>
              </dl>
              {admin && !own && <p className="k">Viewing sensitive details is recorded in the audit log.</p>}
            </Card>)}
          {(admin || own) && <Documents id={id} canUpload />}
          {admin && <ManagerCard id={id} current={d.managerId} names={names} />}
          {admin && (
            <Card><h2>Compensation history</h2>
              <p className="k">Viewing salary is recorded in the audit log.</p>
              <ErrorNote error={comp.error} />
              {comp.data?.length === 0 && <p className="k">No compensation recorded.</p>}
              {!!comp.data?.length && <div style={{ overflowX: "auto" }}><table className="t"><thead><tr><th scope="col">Effective from</th><th scope="col">Monthly gross</th><th scope="col">Reason</th></tr></thead>
                <tbody>{comp.data.map((c) => <tr key={c.id}><td>{c.effectiveFrom}</td><td>{inr(c.monthlyGrossPaise)}</td><td>{c.reason}</td></tr>)}</tbody></table></div>}
            </Card>)}
          {(admin || own) && (
            <Card><h2>Assets</h2>
              <ErrorNote error={assets.error} />
              {assets.data?.length === 0 && <p className="k">No assets issued.</p>}
              {assets.data?.map((a) => <div key={a.assignmentId} style={{ padding: "6px 0", borderTop: "1px solid #eceef4" }}><code>{a.asset.tag}</code> {[a.asset.category, a.asset.model].filter(Boolean).join(" · ")} {a.current ? <Chip tone="info">Issued {a.issuedOn}</Chip> : <Chip tone="mute">Returned {a.returnedOn}</Chip>}</div>)}
            </Card>)}
        </>
      )}
    </Page>
  );
}

export default function People() {
  const { id } = useParams<{ id?: string }>();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
  if (!me.data) return <p>Loading…</p>;
  const admin = me.data.roles.includes("hr_admin");
  return id ? <Detail id={id} admin={admin} myId={me.data.employeeId} /> : <List admin={admin} />;
}
