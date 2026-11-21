import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { openHtml } from "../lib/openHtml";
import { Card, Chip, ErrorNote, inr } from "../lib/ui";
import { Avatar } from "../lib/Avatar";
import { ProfileForm } from "./CompleteProfile";
import "../gz.css";

type Me = { email: string; employeeId: string | null; roles: string[] };
type Emp = { fullName: string; code: string; workEmail: string; designation: string | null; department: string | null; location: string | null; joiningDate: string; employmentType: string; status: string; phone?: string | null; personalEmail?: string | null; panMasked?: string | null; accountMasked?: string | null; bankName?: string | null; ifsc?: string | null; managerId: string | null;
  photoFileId: string | null; dob?: string | null; gender?: string | null; currentAddress?: string | null; emergencyContactName?: string | null; emergencyContactRelation?: string | null; emergencyContactPhone?: string | null };
const GENDER: Record<string, string> = { male: "Male", female: "Female", other: "Other", undisclosed: "Prefer not to say" };
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
  const [editing, setEditing] = useState(false);
  const toggle = useMutation({
    mutationFn: (v: { key: string; granted: boolean }) => api(`/me/consents/${v.key}`, { method: "PUT", body: { granted: v.granted, noticeVersion: NOTICE } }),
    onSuccess: () => { setErr(null); qc.invalidateQueries({ queryKey: ["consents"] }); qc.invalidateQueries({ queryKey: ["home"] }); },
    onError: setErr,
  });
  const vibe = useQuery({ queryKey: ["vibe-me"], enabled: !!id, queryFn: () => api<{ key: string; content: { text?: string } | null }[]>("/vibe/me") });
  const status = vibe.data?.find((x) => x.key === "status")?.content?.text;
  const e = emp.data;
  const work: Tile[] = e ? [["id", "Employee code", e.code], ["mail", "Work email", e.workEmail], ["cal", "Date of joining", fmtDate(e.joiningDate)], ["brief", "Employment type", cap(e.employmentType.replace("_", " "))], ["pin", "Location", e.location]] : [];
  const personal: Tile[] = e ? [["cake", "Date of birth", fmtDate(e.dob)], ["user", "Gender", e.gender ? GENDER[e.gender] ?? e.gender : null], ["phone", "Phone", e.phone], ["mail", "Personal email", e.personalEmail], ["home", "Current address", e.currentAddress],
    ["heart", "Emergency contact", e.emergencyContactName ? `${e.emergencyContactName}${e.emergencyContactRelation ? ` (${e.emergencyContactRelation})` : ""}${e.emergencyContactPhone ? ` · ${e.emergencyContactPhone}` : ""}` : null],
    ["card", "PAN", e.panMasked], ["bank", "Bank account", e.accountMasked ? `${e.bankName ?? ""} ${e.accountMasked}`.trim() : null], ["bank", "IFSC", e.ifsc]] : [];
  return (
    <div className="gz" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <ErrorNote error={me.error ?? emp.error} />
      {me.data && !id && <div className="note warn" role="status">No employee record is linked to {me.data.email} yet. Ask HR to link your login.</div>}
      {e && (
        <section className="gz-hero">
          <div className="gz-ringwrap" style={{ width: 132, height: 132 }}><div className="gz-ring" /><div className="gz-avatar" style={{ fontSize: 40 }}><Avatar name={e.fullName} fileId={e.photoFileId} size={110} /></div></div>
          <div style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            {status && <Link href="/vibe" className="gz-pill gz-glass" style={{ alignSelf: "flex-start", color: "#fff", textDecoration: "none" }}><span className="gz-live" />Currently: {status}</Link>}
            <h1>{e.fullName}</h1>
            <span style={{ fontSize: 15, opacity: .92 }}>{[e.designation, e.department, e.location].filter(Boolean).join(" · ")}</span>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
              <button className="gz-btn white" onClick={() => setEditing(true)} disabled={!id}>Edit profile</button>
              <Link className="gz-btn ghost" href="/vibe">Open my vibe page</Link>
            </div>
          </div>
          <span className="gz-pill gz-glass" style={{ color: "#fff", alignSelf: "flex-start", textTransform: "capitalize" }}>{e.status}</span>
        </section>
      )}
      {e && id && editing && (
        <section className="gz-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}><h2 style={{ fontSize: 20 }}>Edit profile</h2><button className="gz-btn sm" onClick={() => setEditing(false)}>Cancel</button></div>
          <ProfileForm id={id} emp={e} onDone={() => setEditing(false)} />
        </section>
      )}
      {e && !editing && <>
        <TileGroup title="Work" tiles={work} />
        <TileGroup title="Personal and pay" tiles={personal} foot={<>PAN and account numbers are always shown masked. To upload PAN or Aadhaar, open <Link href={`/people/${id}`}>your people record</Link>.</>} />
      </>}
      {id && (
        <section className="gz-card">
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
            <h2 style={{ fontSize: 18, margin: 0 }}>Your privacy choices</h2><Link href="/privacy" style={{ fontSize: 13, fontWeight: 600 }}>See everything in My privacy</Link></div>
          <p className="k" style={{ margin: "4px 0 8px" }}>Each choice is separate, and saying no never affects your employment. Notice {NOTICE}.</p>
          <ErrorNote error={err} />
          {consents.data?.map((c) => {
            const on = c.status === "granted";
            return (
              <div key={c.key} className="pf-row">
                <label htmlFor={`c-${c.key}`} style={{ flex: 1 }}><b style={{ fontWeight: 600 }}>{c.label}</b>
                  <span className="k" style={{ display: "block" }}>{c.status === "not_set" ? "Not set" : `${on ? "Allowed" : "Withdrawn"}${c.at ? ` on ${new Date(c.at).toLocaleDateString("en-IN")}` : ""}`}{c.required ? " · required" : ""}</span></label>
                <input id={`c-${c.key}`} className="pf-switch" type="checkbox" role="switch" checked={on} disabled={toggle.isPending || (c.required && on)} onChange={(ev) => toggle.mutate({ key: c.key, granted: ev.target.checked })} />
              </div>);
          })}
        </section>
      )}
      {id && <div className="gz-grid" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))" }}>
        <section className="gz-card">
          <h2 style={{ fontSize: 18 }}>My letters</h2>
          <ErrorNote error={letters.error} />
          {letters.data?.length === 0 && <Empty icon="doc" text="No letters yet. When HR issues your offer, appointment or appraisal letter, it lands here." />}
          {letters.data?.map((l) => (
            <div key={l.id} className="pf-row">
              <Ico n="doc" /><span style={{ flex: 1 }}><b style={{ fontWeight: 600, display: "block" }}>{LABEL[l.type] ?? l.type}</b><span className="k">{l.refNo}{l.issuedAt ? ` · ${new Date(l.issuedAt).toLocaleDateString("en-IN")}` : ""}</span></span>
              <button className="gz-btn sm" aria-label={`Open ${LABEL[l.type] ?? l.type} ${l.refNo}`} onClick={() => openHtml(`/letters/${l.id}/html`).catch(setErr)}>Open</button>
            </div>))}
        </section>
        <section className="gz-card">
          <h2 style={{ fontSize: 18 }}>My assets</h2>
          <ErrorNote error={assets.error} />
          {assets.data?.length === 0 && <Empty icon="laptop" text="Nothing issued to you yet. Laptops, phones and other kit HR hands over will show up here." />}
          {assets.data?.map((a) => (
            <div key={a.assignmentId} className="pf-row">
              <Ico n="laptop" /><span style={{ flex: 1 }}><b style={{ fontWeight: 600, display: "block" }}>{[a.asset.category, a.asset.model].filter(Boolean).join(" · ")}</b><span className="k"><code>{a.asset.tag}</code>{a.asset.costPaise != null && ` · ${inr(a.asset.costPaise)}`}</span></span>
              {a.current ? <Chip tone="info">With you since {a.issuedOn}</Chip> : <Chip tone="mute">Returned {a.returnedOn}</Chip>}
            </div>))}
        </section>
      </div>}
    </div>
  );
}

type Tile = [string, string, string | null | undefined];
const fmtDate = (d?: string | null) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : null);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ICONS: Record<string, string> = {
  id: "M4 5h16v14H4zM8 10h.01M12 10h4M8 14h8", mail: "M4 6h16v12H4zM4 7l8 6 8-6", cal: "M5 6h14v14H5zM5 10h14M9 3v4M15 3v4", brief: "M4 8h16v11H4zM9 8V5h6v3",
  pin: "M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10zM12 11h.01", user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0", cake: "M4 21h16v-8H4zM4 16c2 1.5 4 1.5 6 0s4-1.5 6 0 3 1 4 0M12 13V9M12 6h.01",
  phone: "M8 3h8v18H8zM11 18h2", home: "M4 11l8-7 8 7v9H4zM10 20v-5h4v5", heart: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z",
  card: "M3 6h18v12H3zM7 10h4M7 14h10", bank: "M3 10l9-6 9 6M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18", doc: "M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5", laptop: "M5 5h14v10H5zM3 19h18",
};
function Ico({ n }: { n: string }) {
  return <span className="pf-ico" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[n]} /></svg></span>;
}
function TileGroup({ title, tiles, foot }: { title: string; tiles: Tile[]; foot?: ReactNode }) {
  const shown = tiles.filter(([, , v]) => v);
  if (!shown.length) return null;
  return <section className="gz-card">
    <span className="gz-eyebrow" style={{ color: "var(--gz-blue)" }}>{title}</span>
    <div className="pf-tiles">{shown.map(([i, k, v]) => <div key={k} className="pf-tile"><Ico n={i} /><span style={{ minWidth: 0 }}><span className="k" style={{ display: "block" }}>{k}</span><b style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{v}</b></span></div>)}</div>
    {foot && <p className="k" style={{ margin: "12px 0 0" }}>{foot}</p>}
  </section>;
}
function Empty({ icon, text }: { icon: string; text: string }) {
  return <div className="pf-empty"><Ico n={icon} /><span>{text}</span></div>;
}
