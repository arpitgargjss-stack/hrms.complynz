import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { readFileBytes } from "./files";
import { defaultStampUri, type Marks } from "./signatureMarksHtml";

/**
 * Signature and stamp printed on letters and compliance documents for the authorised signatory.
 * An uploaded stamp or signature (Configuration → Company → Signatories) always wins. Otherwise the company's
 * default stamp is used, and the signatory's name is written in a handwriting-style font.
 * Rendering helpers are in signatureMarksHtml.ts (no database), re-exported here for existing callers.
 */
export { CURSIVE_STACK, MARKS_CSS, defaultStampUri, marksHtml, type Marks } from "./signatureMarksHtml";

async function fileUri(id: string | null): Promise<string | null> {
  if (!id) return null;
  const [f] = await db.select().from(schema.files).where(eq(schema.files.id, id)).limit(1);
  if (!f) return null;
  try { return `data:${f.mime};base64,${(await readFileBytes(f.storageKey)).toString("base64")}`; } catch { return null; }
}

/** Marks for the signatory named in the company profile (matched by display name), else the first signatory on record. */
export async function signatoryMarks(signatoryName?: string | null): Promise<Marks> {
  const all = await db.select().from(schema.signatories);
  const sg = all.find((s) => signatoryName && s.displayName.trim().toLowerCase() === signatoryName.trim().toLowerCase()) ?? all[0] ?? null;
  const stamp = await fileUri(sg?.stampFileId ?? null), sig = await fileUri(sg?.signatureFileId ?? null);
  return { stampUri: stamp ?? defaultStampUri(), signatureUri: sig, stampIsDefault: !stamp, signatureIsDefault: !sig, name: sg?.displayName ?? null };
}
