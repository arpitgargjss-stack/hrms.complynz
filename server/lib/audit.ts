import { db, schema } from "../db";
/** Records an action without holding up the request: the write runs in the background and a failure is only logged. */
export async function logAudit(actorEmail: string, action: string, entityType?: string, entityId?: string, detail?: unknown) {
  void db.insert(schema.auditLog).values({ actorEmail, action, entityType, entityId, detail: detail as object | undefined })
    .catch(() => console.error(`audit write failed (${action})`));
}
