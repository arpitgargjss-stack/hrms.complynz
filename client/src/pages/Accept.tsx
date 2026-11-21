import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { publicApi } from "../lib/api";

type Info = { valid: boolean; maskedEmail?: string; accepted?: boolean };
type LetterSet = { letters: { id: string; type: string; refNo: string; html: string }[]; html: string; consentPurposes: { key: string; label: string; required: boolean }[]; accepted: boolean };
const typeLabel = (t: string) => (t === "offer_short" ? "Offer summary" : t === "offer_full" ? "Full offer letter" : "Letter");
const wrapStyle = { maxWidth: 680, margin: "0 auto", padding: "16px 16px 48px" } as const;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main style={wrapStyle}><img src="/logo.png" alt="Complynz" width={160} height={37} style={{ display: "block", margin: "8px 0 16px" }} />{children}</main>
  );
}

export default function Accept() {
  const [, params] = useRoute("/accept/:token");
  const token = params?.token ?? "";
  const [info, setInfo] = useState<Info | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [session, setSession] = useState("");
  const [set, setSet] = useState<LetterSet | null>(null);
  const [which, setWhich] = useState(0);
  const [consents, setConsents] = useState<Record<string, boolean>>({});
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    publicApi<Info>(`/accept/${encodeURIComponent(token)}`).then(setInfo).catch((e: Error) => setLoadErr(e.message));
  }, [token]);

  async function run(fn: () => Promise<void>) { setBusy(true); setErr(""); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }
  const t = encodeURIComponent(token);
  const sendOtp = () => run(async () => { await publicApi(`/accept/${t}/otp`, { method: "POST", body: {} }); setOtpSent(true); });
  const verifyOtp = () => run(async () => {
    const r = await publicApi<{ session: string }>(`/accept/${t}/verify-otp`, { body: { otp } });
    const s = await publicApi<LetterSet>(`/accept/${t}/letter`, { headers: { "X-Accept-Session": r.session } });
    setSession(r.session); setSet(s); setOtp("");
    setConsents(Object.fromEntries(s.consentPurposes.map((c) => [c.key, false]))); // all optional, default off
  });
  const submit = () => run(async () => {
    await publicApi(`/accept/${t}/verify`, { body: { consents, agree: true, typedName: name }, headers: { "X-Accept-Session": session } });
    setDone(true);
  });


  if (loadErr) return <Shell><div className="card"><h1>Something went wrong</h1><p role="alert">{loadErr}</p></div></Shell>;
  if (!info) return <Shell><p>Loading…</p></Shell>;
  if (!info.valid) return <Shell><div className="card"><h1>This link has expired or is not valid</h1><p>Please ask HR to send you a new link.</p></div></Shell>;
  if (done || info.accepted || set?.accepted) return <Shell><div className="card"><h1>{done ? "Thank you, your offer is accepted" : "This offer was already accepted"}</h1><p>{done ? "HR has been notified and will be in touch about the next steps. You can close this page." : "There is nothing more to do here."}</p></div></Shell>;

  if (!set) return (
    <Shell><div className="card">
      <h1>Your offer from Complynz</h1>
      <p>To keep your offer private, we first verify it is you. We will send a 6-digit code to <strong>{info.maskedEmail}</strong>.</p>
      {!otpSent ? <button className="btn p" style={{ width: "100%" }} disabled={busy} onClick={sendOtp}>{busy ? "Sending…" : "Send me a code"}</button> : (
        <form onSubmit={(e) => { e.preventDefault(); verifyOtp(); }}>
          <p className="note info" role="status">If the link is valid, a code is on its way. It is valid for 10 minutes.</p>
          <label className="fld"><span>6-digit code</span><input inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} /></label>
          <p><button className="btn p" style={{ width: "100%" }} disabled={busy || otp.length !== 6}>{busy ? "Checking…" : "Verify and view offer"}</button></p>
          <p><button type="button" className="btn" style={{ width: "100%" }} disabled={busy} onClick={sendOtp}>Send a new code</button></p>
        </form>)}
      {err && <div className="note bad" role="alert">{err}</div>}
    </div></Shell>
  );

  const cur = set.letters[which] ?? set.letters[0];
  return (
    <Shell>
      <div className="card"><h1>Review your offer</h1>
        <p>Read the whole document, including the data-processing choices and the confidentiality annexure, before you accept.</p>
        {set.letters.length > 1 && <div className="tabs" role="tablist">{set.letters.map((l, i) => <button key={l.id} role="tab" aria-selected={which === i} className={which === i ? "on" : ""} onClick={() => setWhich(i)}>{typeLabel(l.type)}</button>)}</div>}
        {cur && <iframe title={`${typeLabel(cur.type)} ${cur.refNo}`} sandbox="" srcDoc={cur.html} style={{ width: "100%", height: "70vh", minHeight: 360, border: "1px solid #e3e6ef", borderRadius: 8, background: "#fff" }} />}
      </div>
      <form className="card" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <h2>Your data choices (all optional)</h2>
        <p className="k">These are separate from your offer. Saying no does not affect your offer or employment. You can change them later.</p>
        {set.consentPurposes.map((c) => (
          <label key={c.key} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "12px 0", borderTop: "1px solid #eceef4", fontSize: 14, lineHeight: 1.5, minHeight: 44 }}>
            <input type="checkbox" checked={!!consents[c.key]} onChange={(e) => setConsents({ ...consents, [c.key]: e.target.checked })} style={{ flex: "0 0 20px", marginTop: 2 }} /><span>{c.label}</span></label>))}
        <label className="fld"><span>Type your full name to sign</span><input required minLength={2} maxLength={120} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label style={{ display: "flex", gap: 12, alignItems: "flex-start", margin: "16px 0", fontSize: 14, lineHeight: 1.5 }}>
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} style={{ flex: "0 0 20px", marginTop: 2 }} /><span>I have read the offer documents and I accept the offer.</span></label>
        {err && <div className="note bad" role="alert">{err}</div>}
        <button className="btn p" style={{ width: "100%" }} disabled={busy || !agree || name.trim().length < 2}>{busy ? "Submitting…" : "Accept offer"}</button>
      </form>
    </Shell>
  );
}
