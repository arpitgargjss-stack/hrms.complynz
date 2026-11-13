/** Pure helpers for OTP and token gates. No env or database access so they can be unit tested. */

export interface OtpState { otpHash: string | null; otpExpiresAt: Date | null; attempts: number }
export type OtpResult = "ok" | "none" | "expired" | "locked" | "mismatch";
export const MAX_OTP_ATTEMPTS = 5;
export const MAX_OTP_SENDS_PER_HOUR = 5;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 60 * 1000;

/** Decide the outcome of an OTP check. `attempts` in the result is the value to persist. */
export function evaluateOtp(state: OtpState, submittedHash: string, now: Date, eq: (a: string, b: string) => boolean = (a, b) => a === b, max = MAX_OTP_ATTEMPTS): { result: OtpResult; attempts: number } {
  if (state.attempts >= max) return { result: "locked", attempts: state.attempts };
  if (!state.otpHash || !state.otpExpiresAt) return { result: "none", attempts: state.attempts };
  if (state.otpExpiresAt.getTime() <= now.getTime()) return { result: "expired", attempts: state.attempts };
  if (eq(state.otpHash, submittedHash)) return { result: "ok", attempts: state.attempts };
  return { result: "mismatch", attempts: state.attempts + 1 };
}

/** Sliding-window send limit. Returns the pruned list including this send when allowed. */
export function canSendOtp(sends: number[], now: number, limit = MAX_OTP_SENDS_PER_HOUR, windowMs = 3600_000): { allowed: boolean; sends: number[] } {
  const recent = sends.filter((t) => now - t < windowMs);
  if (recent.length >= limit) return { allowed: false, sends: recent };
  return { allowed: true, sends: [...recent, now] };
}

/** "john.doe@example.com" -> "j***@e***.com" */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  if (!local || !domain) return "***";
  const dot = domain.lastIndexOf(".");
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${local[0]}***@${host[0] ?? "*"}***${tld}`;
}

/** Short-lived signed session: "<expiryMs>.<signature>". `sign` is an HMAC over the given string. */
export function makeSession(tokenHash: string, now: number, sign: (s: string) => string, ttl = SESSION_TTL_MS): string {
  const exp = now + ttl;
  return `${exp}.${sign(`${tokenHash}:${exp}`)}`;
}
export function checkSession(session: string | undefined, tokenHash: string, now: number, sign: (s: string) => string, eq: (a: string, b: string) => boolean = (a, b) => a === b): boolean {
  if (!session || session.length > 200) return false;
  const i = session.indexOf(".");
  if (i < 1) return false;
  const exp = Number(session.slice(0, i));
  if (!Number.isFinite(exp) || exp <= now) return false;
  const sig = session.slice(i + 1);
  try { return eq(sig, sign(`${tokenHash}:${exp}`)); } catch { return false; }
}

/** In-memory fixed-window counter. Process-local by design (single instance); resets on restart. */
export class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  /** true when allowed. */
  hit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
    if (this.hits.size > 20000) for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
    const cur = this.hits.get(key);
    if (!cur || cur.reset <= now) { this.hits.set(key, { n: 1, reset: now + windowMs }); return true; }
    cur.n += 1;
    return cur.n <= limit;
  }
}
