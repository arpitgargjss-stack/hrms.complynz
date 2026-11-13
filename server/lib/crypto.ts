import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../env";

const key = createHash("sha256").update(env.FIELD_ENCRYPTION_KEY).digest();

/** AES-256-GCM. Output: v1.<iv>.<tag>.<ct> (base64url). */
export function encryptField(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}
export function decryptField(enc: string): string {
  const [v, iv, tag, ct] = enc.split(".");
  if (v !== "v1") throw new Error("Unknown field format");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}
export function hmac(value: string, purpose: string): string {
  return createHmac("sha256", env.HMAC_PEPPER).update(`${purpose}:${value.trim().toLowerCase()}`).digest("hex");
}
export function sha256(buf: Buffer | string): string { return createHash("sha256").update(buf).digest("hex"); }
export function newToken(bytes = 32): { token: string; hash: string } {
  const token = randomBytes(bytes).toString("base64url");
  return { token, hash: sha256(token) };
}
export function newOtp(): string { return String(randomBytes(4).readUInt32BE() % 1_000_000).padStart(6, "0"); }
export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex"), y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}
/** Mask for display: keep last 4. */
export function maskTail(v: string, keep = 4): string { return v.length <= keep ? "*".repeat(v.length) : "*".repeat(v.length - keep) + v.slice(-keep); }
