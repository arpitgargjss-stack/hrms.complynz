import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { openHtml } from "../lib/openHtml";
import { Card, Chip, ErrorNote, Page, inr } from "../lib/ui";

type Me = { email: string; employeeId: string | null; roles: string[] };
type Emp = { fullName: string; code: string; workEmail: string; designation: string | null; department: string | null; location: string | null; joiningDate: string; employmentType: string; status: string; phone?: string | null; personalEmail?: string | null; panMasked?: string | null; accountMasked?: string | null; bankName?: string | null; ifsc?: string | null; managerId: string | null };
type Consent = { key: string; label: string; required: boolean; status: string; noticeVersion: string | null; at: string | null };
type Letter = { id: string; type: string; refNo: string; status: string; issuedAt: string | null };
type MyAsset = { assignmentId: string; issuedOn: string; returnedOn: string | null; current: boolean; asset: { tag: string; category: string; model: string | null; costPaise: number | null } };
const NOTICE = "v1";
const LABEL: Record<string, string> = { offer_short: "Offer letter", offer_full: "Offer letter", appointment: "Appointment letter", appraisal: "Appraisal letter", experience: "Experience letter", relieving: "Relieving letter", pip: "Performance improvement plan", asset_contract: "Asset agreement" };

export default function Profile() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
  const id = me.data?.employeeId;
  const emp = useQuery({ queryKey: ["employee", id], enabled: !!id, queryFn: () => api<Emp>(`/employees/${id}`) });
  const consents = useQuery({ queryKey: ["consents"], enabled: !!id, queryFn: () => api<Consent[]>("/me/consents") });
  const letters = useQuery({ queryKey: ["my-letters"], enabled: !!id, queryFn: () => api<Letter[]>("/me/letters") });
  const assets = useQuery({ queryKey: ["my-assets"], enabled: !!id, queryFn: () => api<MyAsset[]>("/me/assets") });
  const [err, setErr] = useState<unknown>(null);
  const toggle = useMutation({
    mutationFn: (v: { key: string; granted: boolean }) => api(`/me/consents/${v.key}`, { method: "PUT", body: { granted: v.granted, noticeVersion: NOTICE } }),
    onSuccess: () => { setErr(null); qc.invalidateQueries({ queryKey: ["consents"] }); qc.invalidateQueries({ queryKey: ["home"] }); },
    onError: setErr,
  });
  const e = emp.data;
  return (
    <Page title="My profile">
      <ErrorNote error={me.error ?? emp.error} />
      {me.data && !id && <div className="note warn" role="status">No employee record is linked to {me.data.email} yet. Ask HR to link your login.</div>}
      {e && (
        <Card>
          <h2 style={{ fontSize: 20 }}>{e.fullName}</h2>
          <p className="k">{[e.designation, e.department].filter(Boolean).join(" · ")} <Chip tone="ok">{e.status}</Chip></p>
          <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12, margin: 0 }}>
            {([["Employee code", e.code], ["Work email", e.workEmail], ["Date of joining", e.joiningDate], ["Employment type", e.employmentType.replace("_", " ")], ["Location", e.location], ["Phone", e.phone], ["Personal email", e.personalEmail], ["PAN", e.panMasked], ["Bank account", e.accountMasked ? `${e.bankName ?? ""} ${e.accountMasked}` : null], ["IFSC", e.ifsc]] as [string, string | null | undefined][])
              .filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="k">{k}</dt><dd style={{ margin: 0 }}>{v}</dd></div>)}
          </dl>
          <p className="k">PAN and account numbers are shown masked. To update your details or upload documents, open <Link href={`/people/${id}`}>your people record</Link>.</p>
        </Card>
      )}
      {id && (
        <Card>
          <h2>Your privacy choices</h2>
          <p className="k">Each choice is separate. Saying no does not affect your employment. You can change any of them at any time. Notice version {NOTICE}.</p>
          <ErrorNote error={err} />
          {consents.data?.map((c) => {
            const on = c.status === "granted";
            return (
              <div key={c.key} style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderTop: "1px solid #eceef4", minHeight: 44 }}>
                <label htmlFor={`c-${c.key}`} style={{ flex: 1 }}>{c.label}
                  <span className="k" style={{ display: "block" }}>{c.status === "not_set" ? "Not set" : `${on ? "Allowed" : "Withdrawn"}${c.at ? ` on ${new Date(c.at).toLocaleDateString("en-IN")}` : ""}`}{c.required ? " · required" : ""}</span></label>
                <input id={`c-${c.key}`} type="checkbox" role="switch" checked={on} disabled={toggle.isPending || (c.required && on)} onChange={(ev) => toggle.mutate({ key: c.key, granted: ev.target.checked })} style={{ width: 28, height: 28 }} />
              </div>);
          })}
        </Card>
      )}
      {id && (
        <Card>
          <h2>My letters</h2>
          <ErrorNote error={letters.error} />
          {letters.data?.length === 0 && <p className="k">No letters issued to you yet.</p>}
          {letters.data?.map((l) => (
            <div key={l.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", padding: "8px 0", borderTop: "1px solid #eceef4" }}>
              <span>{LABEL[l.type] ?? l.type} <span className="k">{l.refNo}{l.issuedAt ? ` · ${new Date(l.issuedAt).toLocaleDateString("en-IN")}` : ""}</span></span>
              <button className="btn" aria-label={`Open ${LABEL[l.type] ?? l.type} ${l.refNo}`} onClick={() => openHtml(`/letters/${l.id}/html`).catch(setErr)}>Open</button>
            </div>))}
        </Card>
      )}
      {id && (
        <Card>
          <h2>My assets</h2>
          <ErrorNote error={assets.error} />
          {assets.data?.length === 0 && <p className="k">No assets issued to you.</p>}
          {assets.data?.map((a) => (
            <div key={a.assignmentId} style={{ padding: "8px 0", borderTop: "1px solid #eceef4" }}>
              <code>{a.asset.tag}</code> {[a.asset.category, a.asset.model].filter(Boolean).join(" · ")} {a.asset.costPaise != null && <span className="k">({inr(a.asset.costPaise)})</span>}{" "}
              {a.current ? <Chip tone="info">With you since {a.issuedOn}</Chip> : <Chip tone="mute">Returned {a.returnedOn}</Chip>}
            </div>))}
        </Card>
      )}
    </Page>
  );
}
