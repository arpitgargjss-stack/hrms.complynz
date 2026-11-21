import { useEffect, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { AUDIENCE_LABEL, VIBE_NOTICE_VERSION, type Audience } from "@shared/hr/vibe";
import { Avatar } from "./Avatar";

export { VIBE_NOTICE_VERSION };

/** Gradient story ring around a person's photo. */
export function Story({ name, fileId, size = 58 }: { name: string; fileId?: string | null; size?: number }) {
  return <span className="gz-story" style={{ width: size, height: size }}><Avatar name={name} fileId={fileId} size={size - 6} /></span>;
}

export function AudiencePicker({ value, onChange, options = ["only_me", "team", "everyone"] }: { value: Audience; onChange: (a: Audience) => void; options?: Audience[] }) {
  const sub: Record<Audience, string> = { only_me: "A private draft", team: "Your department and manager", everyone: "All current employees" };
  return (
    <div className="gz-radio" role="radiogroup" aria-label="Who can see it">
      {options.map((a) => (
        <button key={a} type="button" role="radio" aria-checked={value === a} className={value === a ? "on" : ""} onClick={() => onChange(a)}>
          <b style={{ display: "block", fontSize: 14 }}>{AUDIENCE_LABEL[a]}</b><span style={{ fontSize: 12, color: "var(--gz-mute)" }}>{sub[a]}</span>
        </button>))}
    </div>
  );
}

/**
 * The one consent for the whole vibe page. Shown once: the first time a card is shared beyond
 * "Only me", or from "Turn on sharing". The box always starts unticked.
 */
export function ConsentBox({ agreed, onChange }: { agreed: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="gz-consent" aria-label="Vibe page consent">
      <b style={{ fontSize: 16 }}>Turn on sharing for your vibe page</b>
      <span style={{ fontSize: 14 }}>You agree once. After that, each card just needs an audience: Only me, My team or Everyone.</span>
      <dl>
        <dt>What</dt><dd>The cards you choose to share on your vibe page</dd>
        <dt>Who sees it</dt><dd>Only the audience you pick for each card</dd>
        <dt>Why</dt><dd>So colleagues can get to know you. Nothing else.</dd>
        <dt>Never used for</dt><dd>Marketing, reviews, pay, hiring decisions, or sharing outside Complynz</dd>
        <dt>Change your mind</dt><dd>Turn sharing off in My privacy and every card is hidden at once</dd>
      </dl>
      <label className="gz-check"><input type="checkbox" checked={agreed} onChange={(e) => onChange(e.target.checked)} />
        <span>I agree to share the cards I publish on my vibe page with the audience I pick. Anyone else in my photos or posts has agreed, and none of them is a child.</span></label>
      <span className="k">Privacy notice {VIBE_NOTICE_VERSION}. You'll get a receipt in My privacy.</span>
    </div>
  );
}
export type VibeConsent = { status: "granted" | "withdrawn" | "not_set"; at: string | null; receipt: string | null; noticeVersion: string | null };
export const consentBody = () => ({ agreed: true as const, noticeVersion: VIBE_NOTICE_VERSION });

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
/** A short burst of brand-coloured confetti. Skipped when the person prefers reduced motion. */
export function confetti() {
  if (reduced()) return;
  const host = document.createElement("div"); host.className = "gz-confetti"; host.setAttribute("aria-hidden", "true");
  const colors = ["#0048e4", "#0048e4", "#2563eb", "#60a5fa", "#34d399"];
  for (let i = 0; i < 70; i++) {
    const p = document.createElement("i");
    p.style.left = Math.random() * 100 + "vw"; p.style.background = colors[i % colors.length];
    p.style.animationDelay = Math.random() * 0.5 + "s"; p.style.transform = `rotate(${Math.random() * 360}deg)`;
    host.appendChild(p);
  }
  document.body.appendChild(host); setTimeout(() => host.remove(), 2600);
}

function Toast({ title, sub, onDone }: { title: string; sub?: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 4200); return () => clearTimeout(t); }, [onDone]);
  return (
    <div className="gz-toast" role="status">
      <span style={{ width: 34, height: 34, borderRadius: 11, background: "#10b981", display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10" /></svg></span>
      <span><b style={{ display: "block", fontSize: 14 }}>{title}</b>{sub && <span style={{ fontSize: 12, color: "#cbd5e1" }}>{sub}</span>}</span>
    </div>
  );
}
/** Small good-news toast, optionally with confetti. Never used on payroll, PIP or exit screens. */
export function celebrate(title: string, sub?: string, withConfetti = false) {
  const host = document.createElement("div"); document.body.appendChild(host);
  const root = createRoot(host);
  root.render(<Toast title={title} sub={sub} onDone={() => { root.unmount(); host.remove(); }} />);
  if (withConfetti) confetti();
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);
  return (
    <div className="gz-modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="gz">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>{title}</h2>
          <button className="gz-btn sm" onClick={onClose} aria-label="Close">Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function useToggle(init = false) { const [v, set] = useState(init); return [v, () => set((x) => !x), set] as const; }
export const PALETTE = [["#0048e4", "#fff"], ["#2563eb", "#fff"], ["#bfdbfe", "#172554"], ["#0048e4", "#fff"], ["#34d399", "#064e3b"], ["#bfdbfe", "#172554"], ["#fff", "#0f172a"]] as const;
export const ago = (d: string | Date) => {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 172800) return "yesterday"; return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};
