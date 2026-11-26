import { useEffect, useState } from "react";
import { useRoute } from "wouter";
import { fileToBase64, publicApi } from "../lib/api";
import { fmtSize, shrinkImage } from "../lib/shrinkImage";

type Info = { valid: boolean; maskedEmail?: string; steps?: string[]; completed?: boolean };
type Doc = { kind: "pan" | "aadhaar" | "photo" | "other"; name: string; mime: string; file: Blob };
const KINDS: { k: Doc["kind"]; l: string }[] = [{ k: "photo", l: "Photo" }, { k: "pan", l: "PAN card" }, { k: "aadhaar", l: "Aadhaar (first 8 digits masked) or other ID" }, { k: "other", l: "Other (address proof, certificates)" }];
const MAX = 10 * 1024 * 1024; // per file, matches server/lib/files.ts
// All documents travel in one request. Keep the total under the server's 25 MB body limit once base64-encoded (x4/3).
const TOTAL_MAX = 17 * 1024 * 1024;
const ALLOWED = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const wrapStyle = { maxWidth: 680, margin: "0 auto", padding: "16px 16px 48px" } as const;

function Shell({ children }: { children: React.ReactNode }) {
  return <main style={wrapStyle}><img src="/logo.png" alt="Complynz" width={160} height={37} style={{ display: "block", margin: "8px 0 12px" }} /><div aria-hidden="true" style={{ height: 6, borderRadius: 99, margin: "0 0 18px", background: "linear-gradient(90deg,#00236e,#0048e4,#3b82f6)" }} />{children}</main>;
}

export default function Onboarding() {
  const [, params] = useRoute("/onboarding/:token");
  const token = params?.token ?? "";
  const t = encodeURIComponent(token);
  const [info, setInfo] = useState<Info | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [session, setSession] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [p, setP] = useState({ fullName: "", relationName: "", dob: "", gender: "", phone: "", address: "", aadhaarLast4: "" });
  const [pan, setPan] = useState("");
  const [bank, setBank] = useState({ bankName: "", accountNumber: "", ifsc: "" });
  const [docs, setDocs] = useState<Doc[]>([]);
  const [preparing, setPreparing] = useState(false);
  const total = docs.reduce((n, d) => n + d.file.size, 0);

  useEffect(() => { if (token) publicApi<Info>(`/onboarding/${t}`).then(setInfo).catch((e: Error) => setLoadErr(e.message)); }, [token, t]);
  async function run(fn: () => Promise<void>) { setBusy(true); setErr(""); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } }
  const sendOtp = () => run(async () => { await publicApi(`/onboarding/${t}/otp`, { method: "POST", body: {} }); setOtpSent(true); });
  const verify = () => run(async () => { const r = await publicApi<{ session: string }>(`/onboarding/${t}/verify-otp`, { body: { otp } }); setSession(r.session); setOtp(""); });

  const steps = info?.steps ?? [];
  const has = (s: string) => steps.includes(s);
  const submit = () => run(async () => {
    const documents = [];
    for (const d of docs) documents.push({ kind: d.kind, name: d.name, mime: d.mime, dataBase64: await fileToBase64(d.file) });
    await publicApi(`/onboarding/${t}/submit`, { headers: { "X-Onboard-Session": session }, body: {
      personal: { fullName: p.fullName, relationName: p.relationName.trim() || undefined, dob: p.dob || undefined, gender: p.gender || undefined, phone: p.phone || undefined, address: p.address || undefined, aadhaarLast4: p.aadhaarLast4 || undefined },
      pan: has("kyc") && pan ? pan.toUpperCase() : undefined,
      bank: has("bank") ? { bankName: bank.bankName, accountNumber: bank.accountNumber, ifsc: bank.ifsc.toUpperCase() } : undefined,
      documents,
    } });
    setDone(true);
  });
  async function addFiles(kind: Doc["kind"], files: FileList | null) {
    const f = files?.[0]; if (!f) return;
    if (docs.length >= 6) { setErr("You can upload up to 6 documents."); return; }
    if (!ALLOWED.has(f.type)) { setErr(`"${f.name}" is not a PDF, PNG, JPEG or WebP file. Please choose another file.`); return; }
    setErr(""); setPreparing(true);
    try {
      // Phone photos are shrunk here so a few camera shots never exceed the upload limit.
      const s = await shrinkImage(f);
      if (s.blob.size > MAX) { setErr(`"${f.name}" is ${fmtSize(s.blob.size)}. Each file must be 10 MB or less. Please choose a smaller file.`); return; }
      if (total + s.blob.size > TOTAL_MAX) { setErr(`Adding "${f.name}" (${fmtSize(s.blob.size)}) would make your documents ${fmtSize(total + s.blob.size)} in total. The limit is ${fmtSize(TOTAL_MAX)}. Please use a smaller file, for example a compressed PDF.`); return; }
      setDocs((cur) => [...cur, { kind, name: s.name.slice(0, 120), mime: s.mime, file: s.blob }]);
    } finally { setPreparing(false); }
  }

  if (loadErr) return <Shell><div className="card"><h1>Something went wrong</h1><p role="alert">{loadErr}</p></div></Shell>;
  if (!info) return <Shell><p>Loading…</p></Shell>;
  if (!info.valid) return <Shell><div className="card"><h1>This link has expired or is not valid</h1><p>Please ask HR to send you a new link.</p></div></Shell>;
  if (done || info.completed) return <Shell><div className="card"><h1>{done ? "Thank you, your details are submitted" : "These details were already submitted"}</h1><p>HR will be in touch about your joining. You can close this page.</p></div></Shell>;

  if (!session) return (
    <Shell><div className="card"><h1>Complete your joining details</h1>
      <p>To keep your details private, we first verify it is you. We will send a 6-digit code to <strong>{info.maskedEmail}</strong>.</p>
      {!otpSent ? <button className="btn p" style={{ width: "100%" }} disabled={busy} onClick={sendOtp}>{busy ? "Sending…" : "Send me a code"}</button> : (
        <form onSubmit={(e) => { e.preventDefault(); verify(); }}>
          <p className="note info" role="status">If the link is valid, a code is on its way. It is valid for 10 minutes.</p>
          <label className="fld"><span>6-digit code</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} /></label>
          <p><button className="btn p" style={{ width: "100%" }} disabled={busy || otp.length !== 6}>{busy ? "Checking…" : "Verify"}</button></p>
          <p><button type="button" className="btn" style={{ width: "100%" }} disabled={busy} onClick={sendOtp}>Send a new code</button></p>
        </form>)}
      {err && <div className="note bad" role="alert">{err}</div>}</div></Shell>
  );

  return (
    <Shell>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="card"><h1>Your joining details</h1><p className="k">Your PAN and account number are stored encrypted and shown to HR in masked form. Your PAN is printed in full only in your non-disclosure agreement.</p></div>
        <div className="card"><h2>Personal details</h2>
          <label className="fld"><span>Full name</span><input required minLength={2} maxLength={120} autoComplete="name" value={p.fullName} onChange={(e) => setP({ ...p, fullName: e.target.value })} /></label>
          <label className="fld"><span>Father's, mother's or spouse's name</span><input required minLength={2} maxLength={120} value={p.relationName} onChange={(e) => setP({ ...p, relationName: e.target.value })} /></label>
          <label className="fld"><span>Date of birth</span><input required type="date" autoComplete="bday" value={p.dob} onChange={(e) => setP({ ...p, dob: e.target.value })} /></label>
          <label className="fld"><span>Gender</span><select value={p.gender} onChange={(e) => setP({ ...p, gender: e.target.value })}><option value="">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option><option value="undisclosed">Undisclosed</option></select></label>
          <label className="fld"><span>Phone</span><input type="tel" inputMode="tel" autoComplete="tel" pattern="\+?[0-9 ]{8,15}" title="8 to 15 digits, optional leading +" value={p.phone} onChange={(e) => setP({ ...p, phone: e.target.value })} /></label>
          <label className="fld"><span>Current address</span><textarea required rows={3} minLength={5} maxLength={500} autoComplete="street-address" value={p.address} onChange={(e) => setP({ ...p, address: e.target.value })} /></label>
          <label className="fld"><span>Aadhaar, last 4 digits only</span><input required inputMode="numeric" pattern="\d{4}" title="The last 4 digits of your Aadhaar" maxLength={4} autoComplete="off" value={p.aadhaarLast4} onChange={(e) => setP({ ...p, aadhaarLast4: e.target.value.replace(/\D/g, "").slice(0, 4) })} /></label>
          <p className="k">Your name, parent's or spouse's name, age, address, PAN and the last 4 Aadhaar digits are printed in your non-disclosure agreement.</p>
        </div>
        {has("kyc") && <div className="card"><h2>PAN</h2>
          <label className="fld"><span>PAN number</span><input required pattern="[A-Za-z]{5}[0-9]{4}[A-Za-z]" title="Format: ABCDE1234F" maxLength={10} autoCapitalize="characters" autoComplete="off" value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} /></label></div>}
        {has("bank") && <div className="card"><h2>Bank details</h2>
          <label className="fld"><span>Bank name</span><input required minLength={2} maxLength={100} value={bank.bankName} onChange={(e) => setBank({ ...bank, bankName: e.target.value })} /></label>
          <label className="fld"><span>Account number</span><input required inputMode="numeric" pattern="\d{9,18}" title="9 to 18 digits" autoComplete="off" value={bank.accountNumber} onChange={(e) => setBank({ ...bank, accountNumber: e.target.value.replace(/\D/g, "") })} /></label>
          <label className="fld"><span>IFSC</span><input required pattern="[A-Za-z]{4}0[A-Za-z0-9]{6}" title="Format: ABCD0123456" maxLength={11} autoCapitalize="characters" autoComplete="off" value={bank.ifsc} onChange={(e) => setBank({ ...bank, ifsc: e.target.value.toUpperCase() })} /></label></div>}
        {has("documents") && <div className="card"><h2>Documents</h2>
          <p className="k">PDF, PNG, JPEG or WebP, up to 10 MB each, up to 6 files. Mask the first 8 digits of your Aadhaar.</p>
          {KINDS.map((k) => <label key={k.k} className="fld"><span>{k.l}</span><input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" disabled={preparing} onChange={(e) => { addFiles(k.k, e.target.files); e.target.value = ""; }} /></label>)}
          {docs.length > 0 && <ul style={{ paddingLeft: 20 }}>{docs.map((d, i) => <li key={i} style={{ margin: "6px 0" }}>{KINDS.find((k) => k.k === d.kind)?.l}: {d.name} <span className="k">({fmtSize(d.file.size)})</span> <button type="button" className="btn" onClick={() => setDocs(docs.filter((_, j) => j !== i))}>Remove</button></li>)}</ul>}
          {preparing && <p className="k" role="status">Preparing your file…</p>}</div>}
        {err && <div className="note bad" role="alert">{err}</div>}
        <button className="btn p" style={{ width: "100%" }} disabled={busy || preparing}>{busy ? "Submitting…" : "Submit details"}</button>
        <p className="k">You can submit only once, so please check everything first.</p>
      </form>
    </Shell>
  );
}
