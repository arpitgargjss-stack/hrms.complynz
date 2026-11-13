import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db, schema } from "../db";
import { env } from "../env";
import { sha256 } from "./crypto";

const ALLOWED = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
const MAX = 10 * 1024 * 1024;

export async function saveFile(opts: { kind: string; buf: Buffer; name: string; mime: string; uploadedBy: string; ownerEmployeeId?: string }) {
  if (!ALLOWED.has(opts.mime)) throw new Error("File type not allowed");
  if (opts.buf.length > MAX) throw new Error("File too large");
  const key = `${new Date().getUTCFullYear()}/${randomUUID()}`;
  const full = path.resolve(env.FILE_STORAGE_DIR, key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, opts.buf, { mode: 0o600 });
  const [row] = await db.insert(schema.files).values({
    kind: opts.kind, ownerEmployeeId: opts.ownerEmployeeId, originalName: opts.name.replace(/[^\w.\- ]/g, "_").slice(0, 120),
    mime: opts.mime, sizeBytes: opts.buf.length, sha256: sha256(opts.buf), storageKey: key, uploadedBy: opts.uploadedBy,
  }).returning();
  return row;
}
export async function readFileBytes(storageKey: string): Promise<Buffer> {
  const full = path.resolve(env.FILE_STORAGE_DIR, storageKey);
  if (!full.startsWith(path.resolve(env.FILE_STORAGE_DIR))) throw new Error("Bad path");
  return readFile(full);
}
