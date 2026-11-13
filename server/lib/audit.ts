import { db, schema } from "../db";
export async function logAudit(actorEmail: string, action: string, entityType?: string, entityId?: string, detail?: unknown) {
  await db.insert(schema.auditLog).values({ actorEmail, action, entityType, entityId, detail: detail as object | undefined });
}
