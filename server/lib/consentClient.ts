import { env } from "../env";

export interface ConsentEventOut { subjectId: string; purposeKey: string; status: "granted" | "withdrawn"; noticeVersion: string }

/**
 * Best-effort mirror of a consent event to the CMP (system of record).
 * Sends only the opaque subject id, purpose key, status and notice version.
 * Never throws and never logs payloads or identifiers.
 */
export function sendConsentEvent(ev: ConsentEventOut): void {
  if (!env.CMP_BASE_URL || !env.CMP_API_KEY) return;
  const url = env.CMP_BASE_URL.replace(/\/+$/, "") + "/api/consent-events";
  const body = JSON.stringify({
    subjectId: ev.subjectId, purposeKey: ev.purposeKey, status: ev.status, noticeVersion: ev.noticeVersion,
    ...(env.CMP_PROPERTY_KEY ? { propertyKey: env.CMP_PROPERTY_KEY } : {}),
  });
  void (async () => {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 5000);
      try {
        await fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.CMP_API_KEY}` }, body, signal: ctl.signal });
      } finally { clearTimeout(t); }
    } catch { /* best effort; the local ledger is authoritative for the app */ }
  })();
}
