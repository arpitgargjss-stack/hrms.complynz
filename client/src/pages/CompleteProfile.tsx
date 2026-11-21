import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fileToBase64 } from "../lib/api";
import { Avatar, squarePhoto } from "../lib/Avatar";
import { Card, ErrorNote, Field } from "../lib/ui";

export type ProfileEmp = {
  fullName: string; photoFileId: string | null; phone?: string | null; personalEmail?: string | null; dob?: string | null; gender?: string | null;
  currentAddress?: string | null; emergencyContactName?: string | null; emergencyContactRelation?: string | null; emergencyContactPhone?: string | null;
  bankName?: string | null; ifsc?: string | null; accountMasked?: string | null;
};
const TEXT = ["phone", "personalEmail", "dob", "gender", "currentAddress", "emergencyContactName", "emergencyContactRelation", "emergencyContactPhone", "bankName", "ifsc"] as const;
type Form = Record<(typeof TEXT)[number] | "accountNumber", string>;
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

/** The editable self-service profile: photo, personal details, emergency contact and (optional) bank details. */
export function ProfileForm({ id, emp, onDone, submitLabel = "Save profile", requirePhoto = true }: { id: string; emp: ProfileEmp; onDone?: () => void; submitLabel?: string; requirePhoto?: boolean }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Form>(() => ({ ...Object.fromEntries(TEXT.map((k) => [k, emp[k] ?? ""])), accountNumber: "" }) as Form);
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
      if (photo) await api(`/employees/${id}/documents`, { method: "POST", body: { kind: "photo", name: "profile-photo.jpg", mime: photo.mime, dataBase64: await fileToBase64(photo.blob) } });
      const body: Record<string, string | null> = {};
      for (const k of TEXT) { const v = f[k].trim(); if (v !== (emp[k] ?? "")) body[k] = v || null; }
      if (f.accountNumber.trim()) body.accountNumber = f.accountNumber.replace(/\s/g, "");
      if (Object.keys(body).length) await api(`/employees/${id}`, { method: "PATCH", body });
    },
    onSuccess: () => {
      for (const k of ["me", "employee", "employees", "org-chart", "home", "docs"]) qc.invalidateQueries({ queryKey: [k] });
      onDone?.();
    },
  });
  const needPhoto = requirePhoto && !photo && !emp.photoFileId;

  return (
    <form onSubmit={(e) => { e.preventDefault(); if (needPhoto) { setPhotoErr("Add a profile photo so colleagues can recognise you."); return; } save.mutate(); }}>
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
      <div className="grid">
        <Field label="Bank name"><input maxLength={120} value={f.bankName} onChange={set("bankName")} /></Field>
        <Field label={emp.accountMasked ? `Account number (on file: ${emp.accountMasked})` : "Account number"}><input inputMode="numeric" autoComplete="off" value={f.accountNumber} onChange={set("accountNumber")} placeholder={emp.accountMasked ? "Leave blank to keep" : ""} /></Field>
        <Field label="IFSC"><input maxLength={11} value={f.ifsc} onChange={(e) => setF({ ...f, ifsc: e.target.value.toUpperCase() })} /></Field>
      </div>

      <ErrorNote error={save.error} />
      <p style={{ marginTop: 20 }}><button className="btn p" disabled={save.isPending}>{save.isPending ? "Saving…" : submitLabel}</button></p>
    </form>
  );
}

/** First-login step: shown before anything else until the required profile fields and photo are in. */
export default function CompleteProfile({ id, onSkip }: { id: string; onSkip: () => void }) {
  const emp = useQuery({ queryKey: ["employee", id], queryFn: () => api<ProfileEmp>(`/employees/${id}`) });
  return (
    <div style={{ minHeight: "100vh", padding: "32px 16px", display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 760 }}>
        <div className="brand" style={{ fontWeight: 600, fontSize: 20, color: "var(--brand)", marginBottom: 16 }}>Complynz</div>
        <div className="pagehead" style={{ display: "block" }}><h1>Complete your profile</h1>
          <p style={{ fontSize: 14, margin: "8px 0 0" }}>
            Welcome{emp.data ? `, ${emp.data.fullName.split(" ")[0]}` : ""}. Add your photo and a few details so HR has what it needs and colleagues can find you. It takes about two minutes.
          </p></div>
        <Card>
          <ErrorNote error={emp.error} />
          {emp.isLoading && <p>Loading…</p>}
          {emp.data && <ProfileForm id={id} emp={emp.data} submitLabel="Save and continue" />}
        </Card>
        <p style={{ textAlign: "center" }}><button className="btn" onClick={onSkip}>Skip for now</button></p>
      </div>
    </div>
  );
}
