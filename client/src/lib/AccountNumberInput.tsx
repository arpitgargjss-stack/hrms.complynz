import { useEffect, useRef, useState } from "react";
import { accountConfirmError } from "../../../shared/hr/accountConfirm";

/**
 * Account number typed twice: first entry masked, second in clear, pasting into the second is blocked.
 * The browser refuses to submit the form until both agree (custom validity on the confirm field).
 */
export function AccountNumberInput({ label, value, confirm, onChange, onConfirm, required, placeholder, digitsOnly }: {
  label: string; value: string; confirm: string; onChange: (v: string) => void; onConfirm: (v: string) => void;
  required?: boolean; placeholder?: string; digitsOnly?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [touched, setTouched] = useState(false);
  const err = accountConfirmError(value, confirm);
  useEffect(() => { ref.current?.setCustomValidity(err ?? ""); }, [err]);
  const clean = (v: string) => (digitsOnly ? v.replace(/\D/g, "") : v);
  return (
    <>
      <label className="fld"><span>{label}</span>
        <input type="password" required={required} inputMode="numeric" autoComplete="off" pattern="[0-9 ]{9,22}" title="9 to 18 digits"
          placeholder={placeholder} value={value} onChange={(e) => onChange(clean(e.target.value))} /></label>
      <label className="fld"><span>Re-enter account number</span>
        <input ref={ref} required={required || !!value} inputMode="numeric" autoComplete="off" value={confirm}
          onPaste={(e) => e.preventDefault()} onBlur={() => setTouched(true)} onChange={(e) => onConfirm(clean(e.target.value))}
          aria-invalid={!!err && touched} aria-describedby={err && touched ? "acct-confirm-err" : undefined} />
        {err && touched && confirm && <small id="acct-confirm-err" role="alert" style={{ color: "var(--bad, #b42318)" }}>{err}</small>}
        {!err && confirm && <small className="k">Account numbers match.</small>}
      </label>
    </>
  );
}
