import { createHash } from "node:crypto";

/**
 * Audit entries record what happened, not the content itself. Long text (policy templates, rendered HTML, embedded
 * images as data: URIs) is replaced by its fingerprint, so the entry still proves which content it was.
 */
export const MAX_AUDIT_STRING = 1024;
export type Fingerprint = { omitted: true; sha256: string; length: number };
export const fingerprint = (s: string): Fingerprint => ({ omitted: true, sha256: createHash("sha256").update(s).digest("hex"), length: s.length });
/** sha256 of any value, for logging "this content" without the content. */
export const digest = (v: unknown) => createHash("sha256").update(typeof v === "string" ? v : JSON.stringify(v ?? null)).digest("hex");

/** Replaces long strings and data: URIs anywhere in an audit detail; everything else is kept. Running it twice changes nothing. */
export function trimDetail(detail: unknown): { detail: unknown; changed: boolean } {
  let changed = false;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") { if (v.length > MAX_AUDIT_STRING || /^data:/i.test(v)) { changed = true; return fingerprint(v); } return v; }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  const out = walk(detail);
  return { detail: out, changed };
}
