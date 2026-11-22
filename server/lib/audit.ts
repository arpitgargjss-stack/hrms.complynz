import { db, schema } from "../db";
import { trimDetail } from "./auditTrim";
/** Records an action without holding up the request: the write runs in the background and a failure is only logged. */
export async function logAudit(actorEmail: string, action: string, entityType?: string, entityId?: string, detail?: unknown) {
  // Never store long content (policy text, HTML, embedded images): it is replaced by a sha256 fingerprint.
  const trimmed = detail === undefined ? undefined : trimDetail(detail).detail;
  void db.insert(schema.auditLog).values({ actorEmail, action, entityType, entityId, detail: trimmed as object | undefined })
    .catch(() => console.error(`audit write failed (${action})`));
}
