import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Pure parts of the signature marks (no database or env access), so payroll helpers and tests can import them.
 * The database lookup of the signatory's uploads lives in signatureMarks.ts.
 */
export type Marks = { stampUri: string | null; signatureUri: string | null; stampIsDefault: boolean; signatureIsDefault: boolean; name?: string | null };

let defaultStamp: string | null | undefined;
/** The default company stamp (client/public/brand/company-stamp.png, also served at /brand/company-stamp.png). */
export function defaultStampUri(): string | null {
  if (defaultStamp !== undefined) return defaultStamp;
  for (const p of ["client/public/brand/company-stamp.png", "dist/client/brand/company-stamp.png", "design/brand/company-stamp.png"]) {
    try { defaultStamp = `data:image/png;base64,${readFileSync(path.resolve(p)).toString("base64")}`; return defaultStamp; } catch { /* try the next place */ }
  }
  defaultStamp = null;
  return null;
}

/** Handwriting-style fonts available on most systems and in browser print-to-PDF, with a generic cursive fallback. */
export const CURSIVE_STACK = `"Snell Roundhand","Apple Chancery","Segoe Script","Brush Script MT","Lucida Handwriting","URW Chancery L",cursive`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The signature line: uploaded signature image, or the name in handwriting, with the stamp beside it. */
export function marksHtml(m: Marks | null | undefined, name: string | null | undefined): string {
  if (!m) return "";
  name = name?.trim() || m.name; // no signatory name in the company profile: use the signatory on record
  const sig = m.signatureUri ? `<img class="sig-img" src="${m.signatureUri}" alt="Signature">`
    : name ? `<span class="sig-cursive" style="font-family:${esc(CURSIVE_STACK)}">${esc(name)}</span>` : "";
  const stamp = m.stampUri ? `<img class="sig-stamp" src="${m.stampUri}" alt="Company stamp">` : "";
  if (!sig && !stamp) return "";
  return `<div class="sig-marks" style="display:flex;align-items:center;gap:18px;margin:10px 0 4px;min-height:70px">${sig ? `<span style="display:inline-block;min-width:160px;border-bottom:1px solid #98a2b3;padding-bottom:2px">${sig}</span>` : ""}${stamp}</div>`;
}
export const MARKS_CSS = `.sig-img{max-height:56px;max-width:200px;display:block}.sig-cursive{font-size:30px;line-height:1.1;color:#1d2a5b;display:inline-block}.sig-stamp{width:96px;height:96px;object-fit:contain;opacity:.92}`;
