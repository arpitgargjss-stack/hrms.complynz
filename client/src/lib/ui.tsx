import type { ReactNode } from "react";
export const inr = (p: number) => { const neg = p < 0; const a = Math.abs(p); const r = String(Math.floor(a / 100)); const l = r.slice(-3), rest = r.slice(0, -3); return `${neg ? "-" : ""}₹${rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," : ""}${l}.${String(a % 100).padStart(2, "0")}`; };
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) { return <div className={`card ${className}`}>{children}</div>; }
export function Chip({ tone = "mute", children }: { tone?: "ok" | "warn" | "info" | "mute" | "bad"; children: ReactNode }) { return <span className={`chip ${tone}`}>{children}</span>; }
export function Page({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return <div><div className="pagehead"><h1>{title}</h1><div className="row-gap">{actions}</div></div>{children}</div>;
}
export function ErrorNote({ error }: { error: unknown }) { return error ? <div className="note bad" role="alert">{(error as Error).message}</div> : null; }
export function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="fld"><span>{label}</span>{children}</label>; }
