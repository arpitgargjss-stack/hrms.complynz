import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { openHtml } from "../lib/openHtml";
import { Card, Chip, ErrorNote, Field, Page, inr } from "../lib/ui";

type Acc = string | { name: string; qty?: number; note?: string };
type Asset = {
  id: string; tag: string; category: string; model: string | null; serialNo: string | null; costPaise: number | null; purchasedOn: string | null;
  condition: string | null; accessories: Acc[] | null; status: string;
  assignedTo: { employeeId: string; name: string | null; code: string | null; issuedOn: string; assignmentId: string } | null;
};
type Emp = { id: string; fullName: string; code: string; status?: string };
const today = () => new Date().toISOString().slice(0, 10);
const accText = (a: Acc[] | null) => (a ?? []).map((x) => (typeof x === "string" ? x : `${x.name}${x.qty && x.qty > 1 ? ` x${x.qty}` : ""}`)).join(", ");
const tone = (s: string) => (s === "assigned" ? "info" : s === "in_stock" ? "ok" : s === "repair" ? "warn" : "mute");
const COND = ["new", "good", "fair", "poor"];
const blank = { tag: "", category: "Laptop", model: "", serialNo: "", cost: "", purchasedOn: "", condition: "new", accessories: "" };

export default function Assets() {
  const qc = useQueryClient();
  const assets = useQuery({ queryKey: ["assets"], queryFn: () => api<Asset[]>("/assets") });
  const emps = useQuery({ queryKey: ["employees"], queryFn: () => api<{ employees: Emp[] }>("/employees") });
  const [f, setF] = useState(blank);
  const [show, setShow] = useState(false);
  const [assign, setAssign] = useState<{ id: string; employeeId: string; issuedOn: string } | null>(null);
  const [ret, setRet] = useState<{ id: string; returnedOn: string; cond: string; status: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["assets"] });

  const create = useMutation({
    mutationFn: () => api("/assets", { method: "POST", body: {
      tag: f.tag, category: f.category, model: f.model || null, serialNo: f.serialNo || null,
      costPaise: f.cost ? Math.round(parseFloat(f.cost) * 100) : null, purchasedOn: f.purchasedOn || null, condition: f.condition,
      accessories: f.accessories.split(",").map((s) => s.trim()).filter(Boolean),
    } }),
    onSuccess: () => { setF(blank); setShow(false); refresh(); },
  });
  const doAssign = useMutation({
    mutationFn: () => api(`/assets/${assign!.id}/assign`, { method: "POST", body: { employeeId: assign!.employeeId, issuedOn: assign!.issuedOn } }),
    onSuccess: () => { setAssign(null); refresh(); },
  });
  const doReturn = useMutation({
    mutationFn: () => api(`/assets/${ret!.id}/return`, { method: "POST", body: { returnedOn: ret!.returnedOn, conditionOnReturn: ret!.cond, status: ret!.status } }),
    onSuccess: () => { setRet(null); refresh(); },
  });
  const contract = useMutation({
    mutationFn: async (a: Asset) => {
      const l = await api<{ id: string }>("/letters", { method: "POST", body: { type: "asset_contract", employeeId: a.assignedTo!.employeeId, payload: {
        assetDescription: [a.category, a.model].filter(Boolean).join(" "), assetTag: a.tag, serialNo: a.serialNo ?? "", accessories: accText(a.accessories),
        ...(a.costPaise != null ? { assetCostPaise: a.costPaise } : {}), issuedOn: a.assignedTo!.issuedOn,
      } } });
      await openHtml(`/letters/${l.id}/html`);
      return l;
    },
    onSuccess: () => setMsg("Asset contract letter created as a draft and opened in a new tab. Print or save it for signature."),
  });
  const people = (emps.data?.employees ?? []).filter((e) => e.status !== "exited");

  return (
    <Page title="Assets" actions={<button className="btn p" aria-expanded={show} onClick={() => setShow(!show)}>Add asset</button>}>
      <p className="k">Tag company equipment and track who has it. Assigned assets appear in the employee's profile.</p>
      {msg && <div className="note ok" role="status">{msg}</div>}
      <ErrorNote error={assets.error} /><ErrorNote error={contract.error} />
      {show && (
        <Card>
          <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
            <h2>Add asset</h2>
            <div className="grid">
              <Field label="Asset tag"><input required maxLength={60} value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} /></Field>
              <Field label="Category"><input required maxLength={60} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
              <Field label="Model"><input maxLength={160} value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} /></Field>
              <Field label="Serial number"><input maxLength={120} value={f.serialNo} onChange={(e) => setF({ ...f, serialNo: e.target.value })} /></Field>
              <Field label="Cost in rupees"><input inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,2})?" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></Field>
              <Field label="Purchased on"><input type="date" value={f.purchasedOn} onChange={(e) => setF({ ...f, purchasedOn: e.target.value })} /></Field>
              <Field label="Condition"><select value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })}>{COND.map((c) => <option key={c}>{c}</option>)}</select></Field>
              <Field label="Accessories (comma separated)"><input value={f.accessories} onChange={(e) => setF({ ...f, accessories: e.target.value })} placeholder="Charger, laptop bag" /></Field>
            </div>
            <ErrorNote error={create.error} />
            <p><button className="btn p" disabled={create.isPending}>Add asset</button></p>
          </form>
        </Card>
      )}
      {assign && (
        <Card>
          <form onSubmit={(e) => { e.preventDefault(); doAssign.mutate(); }}>
            <h2>Assign {assets.data?.find((a) => a.id === assign.id)?.tag}</h2>
            <div className="grid">
              <Field label="Employee"><select required value={assign.employeeId} onChange={(e) => setAssign({ ...assign, employeeId: e.target.value })}><option value="">Select…</option>{people.map((p) => <option key={p.id} value={p.id}>{p.fullName} ({p.code})</option>)}</select></Field>
              <Field label="Issued on"><input type="date" required value={assign.issuedOn} onChange={(e) => setAssign({ ...assign, issuedOn: e.target.value })} /></Field>
            </div>
            <ErrorNote error={doAssign.error} />
            <div className="row-gap" style={{ marginTop: 12 }}><button className="btn p" disabled={doAssign.isPending}>Assign</button><button type="button" className="btn" onClick={() => setAssign(null)}>Cancel</button></div>
          </form>
        </Card>
      )}
      {ret && (
        <Card>
          <form onSubmit={(e) => { e.preventDefault(); doReturn.mutate(); }}>
            <h2>Return {assets.data?.find((a) => a.id === ret.id)?.tag}</h2>
            <div className="grid">
              <Field label="Returned on"><input type="date" required value={ret.returnedOn} onChange={(e) => setRet({ ...ret, returnedOn: e.target.value })} /></Field>
              <Field label="Condition on return"><select value={ret.cond} onChange={(e) => setRet({ ...ret, cond: e.target.value })}>{COND.map((c) => <option key={c}>{c}</option>)}</select></Field>
              <Field label="Then mark as"><select value={ret.status} onChange={(e) => setRet({ ...ret, status: e.target.value })}><option value="in_stock">In stock</option><option value="repair">Repair</option><option value="retired">Retired</option></select></Field>
            </div>
            <ErrorNote error={doReturn.error} />
            <div className="row-gap" style={{ marginTop: 12 }}><button className="btn p" disabled={doReturn.isPending}>Record return</button><button type="button" className="btn" onClick={() => setRet(null)}>Cancel</button></div>
          </form>
        </Card>
      )}
      <Card>
        {assets.isLoading && <p>Loading…</p>}
        <div style={{ overflowX: "auto" }}>
          <table className="t"><thead><tr><th scope="col">Tag</th><th scope="col">Asset</th><th scope="col">Cost</th><th scope="col">Condition</th><th scope="col">Status</th><th scope="col">With</th><th scope="col"><span style={{ position: "absolute", left: -9999 }}>Actions</span></th></tr></thead>
            <tbody>{assets.data?.map((a) => (
              <tr key={a.id}>
                <td><code>{a.tag}</code></td>
                <td>{[a.category, a.model].filter(Boolean).join(" · ")}<span className="k" style={{ display: "block" }}>{a.serialNo ? `S/N ${a.serialNo}` : ""}{a.accessories?.length ? ` · ${accText(a.accessories)}` : ""}</span></td>
                <td>{a.costPaise != null ? inr(a.costPaise) : ""}</td><td>{a.condition}</td>
                <td><Chip tone={tone(a.status)}>{a.status.replace("_", " ")}</Chip></td>
                <td>{a.assignedTo ? <>{a.assignedTo.name}<span className="k" style={{ display: "block" }}>since {a.assignedTo.issuedOn}</span></> : ""}</td>
                <td><div className="row-gap">
                  {a.status === "in_stock" && <button className="btn" aria-label={`Assign ${a.tag}`} onClick={() => { setRet(null); setAssign({ id: a.id, employeeId: "", issuedOn: today() }); }}>Assign</button>}
                  {a.status === "assigned" && <>
                    <button className="btn" aria-label={`Generate asset contract for ${a.tag}`} disabled={contract.isPending} onClick={() => { setMsg(null); contract.mutate(a); }}>Asset contract</button>
                    <button className="btn" aria-label={`Return ${a.tag}`} onClick={() => { setAssign(null); setRet({ id: a.id, returnedOn: today(), cond: a.condition ?? "good", status: "in_stock" }); }}>Return</button>
                  </>}
                </div></td>
              </tr>))}</tbody></table>
        </div>
        {assets.data?.length === 0 && <p className="k">No assets yet.</p>}
      </Card>
    </Page>
  );
}
