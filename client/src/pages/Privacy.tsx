import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getAuthToken } from "../lib/api";
import { ErrorNote } from "../lib/ui";
import { celebrate, type VibeConsent } from "../lib/gz";
import { SharingSwitch } from "./Vibe";
import { AUDIENCE_LABEL, type Audience } from "@shared/hr/vibe";
import "../gz.css";

type Data = {
  vibeConsent: VibeConsent;
  sections: { key: string; label: string; filled: boolean; audience: Audience; at: string | null }[];
  profileChoices: { key: string; label: string; consent: string; at: string | null }[];
  history: { id: string; receipt: string; label: string; status: string; noticeVersion: string; at: string; detail: Record<string, unknown> | null }[];
  policies: { slug: string; title: string; version: number; status: "acknowledged" | "changed" | "to_read"; acknowledgedAt: string | null; previous: { version: number; at: string } | null }[];
  agreements: { id: string; type: string; refNo: string; status: string; issuedAt: string | null; acceptedAt: string | null }[];
};
const LETTER: Record<string, string> = { offer_short: "Offer letter", offer_full: "Offer letter", appointment: "Appointment letter", appraisal: "Appraisal letter", experience: "Experience letter", relieving: "Relieving letter", pip: "Performance improvement plan", asset_contract: "Asset agreement" };
const dt = (s: string | null) => (s ? new Date(s).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const AUD_STYLE: Record<Audience, [string, string]> = { everyone: ["#e6eeff", "#0039b8"], team: ["#eff6ff", "#1e40af"], only_me: ["#f1f5f9", "#334155"] };
type Tab = "vibe" | "history" | "policies" | "letters";
const sectionHead = { padding: "14px 20px", borderBottom: "1px solid var(--gz-line)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" as const };

export default function Privacy() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["privacy"], queryFn: () => api<Data>("/me/privacy") });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["privacy"] }); qc.invalidateQueries({ queryKey: ["vibe"] }); qc.invalidateQueries({ queryKey: ["vibe-me"] }); };
  const hide = useMutation({ mutationFn: (key: string) => api(`/me/vibe/${key}/withdraw`, { method: "POST" }), onSuccess: () => { refresh(); celebrate("Hidden", "Only you can see it now"); } });
  const hideAll = useMutation({ mutationFn: () => api("/me/vibe/consent/withdraw", { method: "POST" }), onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ["vibe-consent"] }); celebrate("Sharing is off", "Every card is now only visible to you"); } });
  async function download() {
    const token = await getAuthToken();
    const r = await fetch("/api/me/privacy/export", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const url = URL.createObjectURL(await r.blob()); const a = document.createElement("a"); a.href = url; a.download = `my-privacy-${new Date().toLocaleDateString("en-CA")}.xlsx`; a.click(); URL.revokeObjectURL(url);
  }
  const d = q.data;
  const on = d?.vibeConsent.status === "granted";
  const shared = on ? d?.sections.filter((s) => s.filled && s.audience !== "only_me").length ?? 0 : 0;
  const acked = d?.policies.filter((p) => p.status === "acknowledged").length ?? 0;
  const [tab, setTab] = useState<Tab>("vibe");
  const toRead = d?.policies.filter((p) => p.status !== "acknowledged").length ?? 0;
  const TABS: [Tab, string, string][] = d ? [
    ["vibe", "Vibe page sharing", `${shared}/${d.sections.filter((s) => s.filled).length}`],
    ["history", "Consent history", String(d.history.length)],
    ["policies", "Policies", `${acked}/${d.policies.length}`],
    ["letters", "Letters", String(d.agreements.length)],
  ] : [];
  return (
    <div className="gz" style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 980 }}>
      <div className="pagehead" style={{ marginBottom: 0, alignItems: "flex-end" }}>
        <div><h1>My privacy</h1>
          <span style={{ color: "var(--gz-mute)", fontSize: 14 }}>Your consents, policy acknowledgements and letters, in one place.</span></div>
        <button className="gz-btn" onClick={download}>Download my data (Excel)</button>
      </div>
      <ErrorNote error={q.error ?? hide.error ?? hideAll.error} />
      {d && toRead > 0 && <div className="note info" style={{ margin: 0, display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <span>{toRead === 1 ? "1 policy needs" : `${toRead} policies need`} your read.</span><button className="gz-btn sm primary" onClick={() => setTab("policies")}>Review</button></div>}
      {d && <div className="gz-tabs" role="tablist" aria-label="Privacy sections">{TABS.map(([k, l, n]) =>
        <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l} <span style={{ opacity: .7, fontWeight: 600, marginLeft: 4 }}>{n}</span></button>)}</div>}

      {d && tab === "vibe" && <section className="gz-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ ...sectionHead, background: "var(--gz-tint)" }}>
          <span><b style={{ fontSize: 16, display: "block" }}>Vibe page sharing is {on ? "on" : "off"}</b>
            <span className="k">{on ? `One consent covers every card. Given ${dt(d.vibeConsent.at)} · receipt ${d.vibeConsent.receipt}` : d.vibeConsent.status === "withdrawn" ? `Turned off ${dt(d.vibeConsent.at)}. Every card is visible only to you.` : "Your cards are visible only to you until you turn sharing on."}</span></span>
          <span style={{ display: "flex", gap: 8 }}><Link className="gz-btn sm" href="/vibe">Open vibe page</Link>
            {on ? <button className="gz-btn sm" style={{ color: "#b91c1c" }} disabled={hideAll.isPending} onClick={() => hideAll.mutate()}>Turn off sharing</button> : <SharingSwitch />}</span></div>
        <div style={{ overflowX: "auto" }}><table className="t" style={{ fontSize: 14 }}><thead><tr><th>Card</th><th>Who sees it</th><th>Updated</th><th /></tr></thead><tbody>
          {d.sections.filter((s) => s.filled).map((s) => { const live = on && s.audience !== "only_me"; const a = live ? s.audience : "only_me"; return (
            <tr key={s.key}><td><b>{s.label}</b></td><td><span className="gz-pill" style={{ fontSize: 12, padding: "3px 10px", background: AUD_STYLE[a][0], color: AUD_STYLE[a][1] }}>{AUDIENCE_LABEL[a]}</span>{!on && s.audience !== "only_me" && <span className="k" style={{ display: "block" }}>{AUDIENCE_LABEL[s.audience]} when sharing is on</span>}</td>
              <td className="k">{dt(s.at)}</td>
              <td style={{ textAlign: "right" }}>{live && <button className="gz-btn sm" disabled={hide.isPending} onClick={() => hide.mutate(s.key)}>Hide</button>}</td></tr>); })}
          {d.sections.every((s) => !s.filled) && <tr><td colSpan={4} className="k">Nothing yet. <Link href="/vibe">Start your vibe page</Link>.</td></tr>}
        </tbody></table></div>
        <div style={{ padding: "14px 20px", borderTop: "1px solid var(--gz-line)", display: "grid", gap: 6 }}>
          <b style={{ fontSize: 14 }}>Profile privacy choices</b>
          {d.profileChoices.map((c) => <div key={c.key} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13 }}><span>{c.label}</span><span style={{ fontWeight: 600, color: c.consent === "granted" ? "#047857" : "var(--gz-mute)" }}>{c.consent === "granted" ? "Allowed" : c.consent === "withdrawn" ? "Withdrawn" : "Not set"}</span></div>)}
          <Link href="/profile" style={{ fontSize: 13, fontWeight: 600 }}>Change on My profile</Link>
          <span className="k" style={{ marginTop: 6 }}>HR can see consent history for audits, but not cards set to Only me. Nothing on your vibe page is used in reviews, pay or hiring.</span>
        </div>
      </section>}

      {d && tab === "history" && <section className="gz-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={sectionHead}><b style={{ fontSize: 16 }}>Consent history</b><span className="k">Append-only. Nobody can edit or delete it, including HR.</span></div>
        {d.history.length === 0 ? <p className="k" style={{ padding: "0 20px" }}>No consents recorded yet.</p> :
        <div style={{ overflowX: "auto" }}><table className="t" style={{ fontSize: 14 }}><thead><tr><th>What</th><th>Action</th><th>When</th><th>Receipt</th></tr></thead><tbody>
          {d.history.map((h) => <tr key={h.id}><td><b>{h.label}</b>{h.detail?.audience ? <span className="k" style={{ display: "block" }}>{AUDIENCE_LABEL[h.detail.audience as Audience] ?? String(h.detail.audience)}{h.detail.othersConfirmed ? ", others shown confirmed" : ""}</span> : null}</td>
            <td><span style={{ fontWeight: 600, color: h.status === "granted" ? "#047857" : "var(--gz-mute)" }}>{h.status === "granted" ? "Gave consent" : "Withdrew"}</span></td>
            <td style={{ whiteSpace: "nowrap" }}>{dt(h.at)}</td><td className="k">{h.receipt} · notice {h.noticeVersion}</td></tr>)}
        </tbody></table></div>}
      </section>}

      {d && tab === "policies" && <section className="gz-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={sectionHead}><b style={{ fontSize: 16 }}>Policies you've read</b><span className="k">Each version is acknowledged separately</span></div>
        <div style={{ overflowX: "auto" }}><table className="t" style={{ fontSize: 14 }}><thead><tr><th>Policy</th><th>Version</th><th>Status</th><th /></tr></thead><tbody>
          {d.policies.map((p) => <tr key={p.slug}><td><b>{p.title}</b></td><td>v{p.version}</td>
            <td><span style={{ fontWeight: 600, color: p.status === "acknowledged" ? "#047857" : "#0039b8" }}>{p.status === "acknowledged" ? "Acknowledged" : p.status === "changed" ? "Updated, needs your read" : "To read"}</span>
              <span className="k" style={{ display: "block" }}>{p.acknowledgedAt ? dt(p.acknowledgedAt) : p.previous ? `v${p.previous.version} acknowledged ${dt(p.previous.at)}` : ""}</span></td>
            <td style={{ textAlign: "right" }}><Link className={`gz-btn sm ${p.status === "acknowledged" ? "" : "primary"}`} href={`/policies/${p.slug}`}>{p.status === "acknowledged" ? "Read again" : p.status === "changed" ? "See what changed" : "Read"}</Link></td></tr>)}
          {d.policies.length === 0 && <tr><td colSpan={4} className="k">No policies published yet.</td></tr>}
        </tbody></table></div>
      </section>}

      {d && tab === "letters" && <section className="gz-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={sectionHead}><b style={{ fontSize: 16 }}>Agreements and letters</b><Link href="/profile" style={{ fontSize: 13, fontWeight: 600 }}>View on My profile</Link></div>
        {d.agreements.length === 0 ? <p className="k" style={{ padding: "0 20px" }}>No letters or agreements issued to you yet.</p> :
        <div style={{ overflowX: "auto" }}><table className="t" style={{ fontSize: 14 }}><thead><tr><th>Letter</th><th>Reference</th><th>Status</th></tr></thead><tbody>
          {d.agreements.map((a) => <tr key={a.id}><td><b>{LETTER[a.type] ?? a.type}</b></td><td className="k">{a.refNo}</td>
            <td>{a.acceptedAt ? `Accepted ${dt(a.acceptedAt)}` : a.status === "accepted" ? "Accepted" : `Issued ${dt(a.issuedAt)}`}</td></tr>)}
        </tbody></table></div>}
      </section>}
    </div>
  );
}
