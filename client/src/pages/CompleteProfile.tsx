import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fileToBase64 } from "../lib/api";
import { Avatar, squarePhoto } from "../lib/Avatar";
import { Card, ErrorNote, Field } from "../lib/ui";
import { AccountNumberInput } from "../lib/AccountNumberInput";
import { accountConfirmError } from "../../../shared/hr/accountConfirm";
import "./completeProfile.css";

export type ProfileEmp = {
  fullName: string; photoFileId: string | null; phone?: string | null; personalEmail?: string | null; dob?: string | null; gender?: string | null;
  currentAddress?: string | null; emergencyContactName?: string | null; emergencyContactRelation?: string | null; emergencyContactPhone?: string | null;
  bankName?: string | null; ifsc?: string | null; accountMasked?: string | null;
};
const TEXT = ["phone", "personalEmail", "dob", "gender", "currentAddress", "emergencyContactName", "emergencyContactRelation", "emergencyContactPhone", "bankName", "ifsc"] as const;
type Form = Record<(typeof TEXT)[number] | "accountNumber" | "accountConfirm", string>;
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

/** The editable self-service profile: photo, personal details, emergency contact and (optional) bank details. */
type Onb = {
  noticeVersion: string;
  acknowledgements: { key: string; label: string; done: boolean; at: string | null }[];
  optional: { key: string; label: string; retention: string; status: "granted" | "withdrawn" | "not_set"; at: string | null; via: string | null }[];
};
/** Friendlier choices first; the formal ones from the offer letter after. */
const OPT_ORDER = ["show_birthday", "login_activity", "non_essential_comms", "media_marketing", "intra_group_sharing", "bgv_sharing", "biometric"];
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");

export function ProfileForm({ id, emp, onDone, submitLabel = "Save profile", requirePhoto = true, onboarding = false }: { id: string; emp: ProfileEmp; onDone?: () => void; submitLabel?: string; requirePhoto?: boolean; onboarding?: boolean }) {
  const qc = useQueryClient();
  const onb = useQuery({ queryKey: ["onboarding-consents"], enabled: onboarding, queryFn: () => api<Onb>("/me/onboarding-consents") });
  const [acks, setAcks] = useState<Set<string>>(new Set());
  const [opts, setOpts] = useState<Set<string>>(new Set()); // nothing pre-ticked
  const [ackErr, setAckErr] = useState<string | null>(null);
  const flip = (s: Set<string>, k: string) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; };
  const ackTodo = onb.data?.acknowledgements.filter((a) => !a.done) ?? [];
  const ackLeft = ackTodo.filter((a) => !acks.has(a.key)).length;
  const [f, setF] = useState<Form>(() => ({ ...Object.fromEntries(TEXT.map((k) => [k, emp[k] ?? ""])), accountNumber: "", accountConfirm: "" }) as Form);
  const [photo, setPhoto] = useState<{ blob: Blob; mime: string; preview: string } | null>(null);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.preview); }, [photo]);
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function pick(file: File | undefined) {
    setPhotoErr(null);
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return setPhotoErr("Choose a PNG, JPEG or WebP image.");
    if (file.size > 10 * 1024 * 1024) return setPhotoErr("That image is over 10 MB.");
    const p = await squarePhoto(file);
    setPhoto({ ...p, preview: URL.createObjectURL(p.blob) });
  }

  const save = useMutation({
    mutationFn: async () => {
      const mismatch = accountConfirmError(f.accountNumber, f.accountConfirm);
      if (mismatch) throw new Error(mismatch);
      if (photo) await api(`/employees/${id}/documents`, { method: "POST", body: { kind: "photo", name: "profile-photo.jpg", mime: photo.mime, dataBase64: await fileToBase64(photo.blob) } });
      const body: Record<string, string | null> = {};
      for (const k of TEXT) { const v = f[k].trim(); if (v !== (emp[k] ?? "")) body[k] = v || null; }
      if (f.accountNumber.trim()) body.accountNumber = f.accountNumber.replace(/\s/g, "");
      if (Object.keys(body).length) await api(`/employees/${id}`, { method: "PATCH", body });
      if (onboarding) await api("/me/onboarding-consents", { method: "POST", body: { acknowledged: [...acks], granted: [...opts] } });
    },
    onSuccess: () => {
      for (const k of ["me", "employee", "employees", "org-chart", "home", "docs", "consents", "privacy", "onboarding-consents"]) qc.invalidateQueries({ queryKey: [k] });
      onDone?.();
    },
  });
  const needPhoto = requirePhoto && !photo && !emp.photoFileId;

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      if (needPhoto) { setPhotoErr("Add a profile photo so colleagues can recognise you."); return; }
      if (onboarding && (!onb.data || ackLeft)) { setAckErr(`Tick ${ackLeft === 1 ? "the last required box" : `all ${ackLeft} required boxes`} to continue.`); document.getElementById("ob-required")?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
      save.mutate();
    }}>
      <div style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
        <Avatar name={emp.fullName} fileId={emp.photoFileId} src={photo?.preview} size={112} />
        <div>
          <label className="btn" style={{ display: "inline-flex", alignItems: "center", position: "relative" }}>
            {photo || emp.photoFileId ? "Change photo" : "Upload photo"}
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => pick(e.target.files?.[0])} style={{ position: "absolute", width: 1, height: 1, opacity: 0 }} />
          </label>
          <p className="k" style={{ margin: "6px 0 0" }}>A clear, front-facing photo. It appears on the org chart and your profile.</p>
          {photoErr && <div className="note bad" role="alert" style={{ marginTop: 8 }}>{photoErr}</div>}
        </div>
      </div>

      <h2 style={{ marginTop: 24 }}>Personal details</h2>
      <div className="grid">
        <Field label="Mobile number"><input required type="tel" autoComplete="tel" value={f.phone} onChange={set("phone")} placeholder="+91 98765 43210" /></Field>
        <Field label="Personal email"><input required type="email" autoComplete="email" value={f.personalEmail} onChange={set("personalEmail")} /></Field>
        <Field label="Date of birth"><input required type="date" max={today()} min="1900-01-01" value={f.dob} onChange={set("dob")} /></Field>
        <Field label="Gender"><select required value={f.gender} onChange={set("gender")}>
          <option value="" disabled>Select</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option><option value="undisclosed">Prefer not to say</option>
        </select></Field>
      </div>
      <Field label="Current address"><textarea required rows={3} maxLength={500} autoComplete="street-address" value={f.currentAddress} onChange={set("currentAddress")} /></Field>

      <h2 style={{ marginTop: 24 }}>Emergency contact</h2>
      <div className="grid">
        <Field label="Name"><input required maxLength={160} value={f.emergencyContactName} onChange={set("emergencyContactName")} /></Field>
        <Field label="Relation"><input required maxLength={60} value={f.emergencyContactRelation} onChange={set("emergencyContactRelation")} placeholder="Parent, spouse, sibling…" /></Field>
        <Field label="Phone"><input required type="tel" value={f.emergencyContactPhone} onChange={set("emergencyContactPhone")} /></Field>
      </div>

      <h2 style={{ marginTop: 24 }}>Bank details for salary <span className="k" style={{ fontWeight: 400 }}>(optional, HR can add these too)</span></h2>
      <p className="k">A new or changed account is checked by HR before salary is paid to it. Upload a cancelled cheque, passbook page or banking screenshot under Documents in your people record.</p>
      <div className="grid">
        <Field label="Bank name"><input maxLength={120} value={f.bankName} onChange={set("bankName")} /></Field>
        <AccountNumberInput label={emp.accountMasked ? `Account number (on file: ${emp.accountMasked})` : "Account number"} value={f.accountNumber} confirm={f.accountConfirm}
          onChange={(v) => setF({ ...f, accountNumber: v })} onConfirm={(v) => setF({ ...f, accountConfirm: v })} placeholder={emp.accountMasked ? "Leave blank to keep" : undefined} />
        <Field label="IFSC"><input maxLength={11} value={f.ifsc} onChange={(e) => setF({ ...f, ifsc: e.target.value.toUpperCase() })} /></Field>
      </div>

      {onboarding && <>
        <h2 style={{ marginTop: 28 }}>Your consents</h2>
        <ErrorNote error={onb.error} />
        {onb.isLoading && <p className="k">Loading…</p>}
        {onb.data && <>
          <div id="ob-required" className="ob-group">
            <div className="ob-grouphead"><b>Required to continue</b><span className="ob-pill req">Required</span></div>
            <p className="k ob-lede">These cover what HR needs to employ and pay you. Each tick is saved with the date and time in your consent log.</p>
            <details className="ob-notice">
              <summary>Read the employee privacy notice</summary>
              <p>Complynz uses your personal details for things that are part of employing you, without asking separately each time, as the Digital Personal Data Protection Act, 2023 allows:</p>
              <ul>
                <li>Identity, address and education checks for onboarding and statutory registration</li>
                <li>Payroll, tax deducted at source, and PF, ESI and gratuity where they apply</li>
                <li>Attendance, leave, performance, training and everyday HR admin</li>
                <li>Security and access control, audits, investigations and grievances</li>
              </ul>
              <p>Details are kept only as long as the law or the purpose needs, then erased or anonymised. You can see what is held, ask for corrections, download your data and raise a grievance from My privacy. Anything beyond this needs your yes, which is what the optional choices below are for.</p>
              <p className="k">Notice {onb.data.noticeVersion}</p>
            </details>
            {onb.data.acknowledgements.map((a) => a.done
              ? <div key={a.key} className="ob-tick done"><span className="ob-check" aria-hidden>✓</span><span>{a.label}<span className="k ob-sub">Recorded {day(a.at)}</span></span></div>
              : <label key={a.key} className={"ob-tick" + (acks.has(a.key) ? " on" : "")}>
                <input type="checkbox" checked={acks.has(a.key)} onChange={() => { setAcks(flip(acks, a.key)); setAckErr(null); }} />
                <span>{a.label}</span></label>)}
            {ackErr && <div className="note bad" role="alert" style={{ margin: "8px 0 0" }}>{ackErr}</div>}
          </div>

          <div className="ob-group">
            <div className="ob-grouphead"><b>Optional, your call</b><span className="ob-pill">Optional</span></div>
            <p className="k ob-lede">Nothing is ticked for you. Saying no never affects your job, pay or benefits, and you can change any of these later in My privacy.</p>
            {[...onb.data.optional].sort((x, y) => OPT_ORDER.indexOf(x.key) - OPT_ORDER.indexOf(y.key)).map((o) => o.status !== "not_set"
              ? <div key={o.key} className="ob-tick done"><span className={"ob-check" + (o.status === "granted" ? "" : " no")} aria-hidden>{o.status === "granted" ? "✓" : "–"}</span>
                <span>{o.label}<span className="k ob-sub">{o.status === "granted" ? "Yes" : "No"}, recorded {day(o.at)}{o.via ? ` at ${o.via}` : ""}. Change it in My privacy.</span></span></div>
              : <label key={o.key} className={"ob-tick" + (opts.has(o.key) ? " on" : "")}>
                <input type="checkbox" checked={opts.has(o.key)} onChange={() => setOpts(flip(opts, o.key))} />
                <span>{o.label}<span className="k ob-sub">Kept: {o.retention}</span></span></label>)}
          </div>
        </>}
      </>}

      <ErrorNote error={save.error} />
      <div className="form-actions" style={{ marginTop: onboarding ? 20 : undefined }}>
        <button className="btn p" disabled={save.isPending || (onboarding && !onb.data)}>{save.isPending ? "Saving…" : submitLabel}</button>
        {onboarding && onb.data && <span className="k" role="status">{ackLeft ? `${ackLeft} required ${ackLeft === 1 ? "box" : "boxes"} left to tick` : "All required boxes ticked"}</span>}
      </div>
    </form>
  );
}

/** First-login step: shown before anything else until the required fields, photo and acknowledgements are in. There is no skip. */
export default function CompleteProfile({ id, onSignOut }: { id: string; onSignOut: () => Promise<void> }) {
  const emp = useQuery({ queryKey: ["employee", id], queryFn: () => api<ProfileEmp>(`/employees/${id}`) });
  const [out, setOut] = useState(false);
  return (
    <div style={{ minHeight: "100vh", padding: "32px 16px", display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 760 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div className="brand" style={{ fontWeight: 600, fontSize: 20, color: "var(--brand)" }}>Complynz</div>
          <button type="button" className="btn sm" disabled={out} onClick={async () => { setOut(true); try { await onSignOut(); } finally { setOut(false); } }}>{out ? "Signing out…" : "Sign out"}</button>
        </div>
        <div className="pagehead" style={{ display: "block" }}><h1>Complete your profile</h1>
          <p style={{ fontSize: 14, margin: "8px 0 0" }}>
            Welcome{emp.data ? `, ${emp.data.fullName.split(" ")[0]}` : ""}. Add your photo, a few details and your consent choices so HR has what it needs and colleagues can find you. It takes about three minutes, and you can get into the app as soon as it is done.
          </p></div>
        <Card>
          <ErrorNote error={emp.error} />
          {emp.isLoading && <p>Loading…</p>}
          {emp.data && <ProfileForm id={id} emp={emp.data} submitLabel="Save and continue" onboarding />}
        </Card>
      </div>
    </div>
  );
}
