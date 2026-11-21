import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Card, ErrorNote, Field, Page } from "../lib/ui";
import { INDIAN_STATES } from "../../../shared/hr/presets";

type Row = { id: string; name: string; level?: number | null; address?: string | null; lat?: string | null; lng?: string | null; radiusM?: number | null; isRemote?: boolean | null; state?: string | null };
type Kind = "departments" | "designations" | "locations";
const TABS: { k: Kind; label: string; singular: string }[] = [
  { k: "departments", label: "Departments", singular: "department" }, { k: "designations", label: "Designations", singular: "designation" }, { k: "locations", label: "Locations", singular: "location" },
];
const blank = { name: "", level: "", address: "", lat: "", lng: "", radiusM: "150", isRemote: false, state: "" };

function Section({ kind, singular }: { kind: Kind; singular: string }) {
  const qc = useQueryClient();
  const [f, setF] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const q = useQuery({ queryKey: [kind], queryFn: () => api<Row[]>("/" + kind) });
  const body = () => {
    if (kind === "departments") return { name: f.name };
    if (kind === "designations") return { name: f.name, ...(f.level !== "" ? { level: Number(f.level) } : {}) };
    if (f.isRemote) return { name: f.name, address: f.address || null, isRemote: true, lat: null, lng: null, state: f.state || null };
    return { name: f.name, address: f.address || null, state: f.state || null, isRemote: false, lat: f.lat ? f.lat : null, lng: f.lng ? f.lng : null, radiusM: Number(f.radiusM) || 150 };
  };
  const done = () => { setF(blank); setEditing(null); qc.invalidateQueries({ queryKey: [kind] }); };
  const save = useMutation({ mutationFn: () => api(editing ? `/${kind}/${editing}` : "/" + kind, { method: editing ? "PATCH" : "POST", body: body() }), onSuccess: done });
  const del = useMutation({ mutationFn: (id: string) => api(`/${kind}/${id}`, { method: "DELETE" }), onSuccess: done });
  const edit = (r: Row) => { setEditing(r.id); setF({ name: r.name, level: r.level != null ? String(r.level) : "", address: r.address ?? "", lat: r.lat ?? "", lng: r.lng ?? "", radiusM: String(r.radiusM ?? 150), isRemote: !!r.isRemote, state: r.state ?? "" }); };
  return (
    <>
      <Card>
        <ErrorNote error={q.error} /><ErrorNote error={del.error} />
        <div style={{ overflowX: "auto" }}>
          <table className="t"><thead><tr><th scope="col">Name</th>{kind === "designations" && <th scope="col">Level</th>}{kind === "locations" && <><th scope="col">Address</th><th scope="col">Geofence</th></>}<th scope="col"><span style={{ position: "absolute", left: -9999 }}>Actions</span></th></tr></thead>
            <tbody>{q.data?.map((r) => (
              <tr key={r.id}><td>{r.name}</td>
                {kind === "designations" && <td>{r.level ?? 0}</td>}
                {kind === "locations" && <><td>{r.address ?? ""}{r.state ? <div className="k">{r.state}</div> : <div className="k" style={{ color: "#8a1c1c" }}>State not set</div>}</td><td>{r.isRemote ? <span className="k">Remote, no geofence</span> : r.lat && r.lng ? `${r.lat}, ${r.lng} · ${r.radiusM ?? 150} m` : <span className="k">Not set</span>}</td></>}
                <td><div className="row-gap"><button className="btn" aria-label={`Edit ${r.name}`} onClick={() => edit(r)}>Edit</button>
                  <button className="btn" aria-label={`Delete ${r.name}`} disabled={del.isPending} onClick={() => { if (confirm(`Delete ${r.name}?`)) del.mutate(r.id); }}>Delete</button></div></td></tr>
            ))}</tbody></table>
        </div>
        {q.data?.length === 0 && <p className="k">None yet.</p>}
      </Card>
      <Card>
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <h2>{editing ? `Edit ${singular}` : `Add ${singular}`}</h2>
          <div className="grid">
            <Field label="Name"><input required maxLength={120} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            {kind === "designations" && <Field label="Level (0 to 50)"><input type="number" min={0} max={50} value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })} /></Field>}
            {kind === "locations" && <>
              <Field label="Address"><input maxLength={500} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
              <Field label="State (sets professional tax and state compliance)"><select value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}><option value="">Select state</option>{INDIAN_STATES.map((x) => <option key={x}>{x}</option>)}</select></Field>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}><input type="checkbox" style={{ width: "auto", minHeight: 0 }} checked={f.isRemote} onChange={(e) => setF({ ...f, isRemote: e.target.checked })} />Remote (punch in and out allowed, no geofence)</label>
              {!f.isRemote && <><Field label="Latitude (-90 to 90)"><input inputMode="decimal" value={f.lat} onChange={(e) => setF({ ...f, lat: e.target.value })} /></Field>
              <Field label="Longitude (-180 to 180)"><input inputMode="decimal" value={f.lng} onChange={(e) => setF({ ...f, lng: e.target.value })} /></Field>
              <Field label="Geofence radius in metres (20 to 5000)"><input type="number" min={20} max={5000} value={f.radiusM} onChange={(e) => setF({ ...f, radiusM: e.target.value })} /></Field></>}
            </>}
          </div>
          {kind === "locations" && <p className="k">The geofence is used only to check whether a punch is inside or outside the office. Employees at a remote location can still punch in and out, but their location is not asked for or checked.</p>}
          <ErrorNote error={save.error} />
          <div className="row-gap" style={{ marginTop: 12 }}>
            <button className="btn p" disabled={save.isPending}>{editing ? "Save changes" : `Add ${singular}`}</button>
            {editing && <button type="button" className="btn" onClick={() => { setEditing(null); setF(blank); }}>Cancel</button>}
          </div>
        </form>
      </Card>
    </>
  );
}

export default function Org() {
  const [tab, setTab] = useState<Kind>("departments");
  const t = TABS.find((x) => x.k === tab)!;
  return (
    <Page title="Organisation">
      <p className="k">Departments, designations and office locations used across people, attendance and payroll.</p>
      <div className="tabs" role="tablist" aria-label="Organisation sections">
        {TABS.map((x) => <button key={x.k} role="tab" aria-selected={tab === x.k} className={tab === x.k ? "on" : ""} onClick={() => setTab(x.k)}>{x.label}</button>)}
      </div>
      <Section key={tab} kind={tab} singular={t.singular} />
    </Page>
  );
}
