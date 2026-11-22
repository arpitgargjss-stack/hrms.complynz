import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_AUDIT_STRING, trimDetail } from "./auditTrim";

test("long text and data URIs are replaced by a fingerprint; other fields are kept; trimming twice changes nothing", () => {
  const big = "<style>x</style>" + "p".repeat(MAX_AUDIT_STRING + 10);
  const detail = { slug: "posh", version: 2, after: { title: "POSH", template: big, logo: "data:image/png;base64,AAAA" }, list: ["short", big] };
  const a = trimDetail(detail);
  assert.equal(a.changed, true);
  const d = a.detail as { slug: string; version: number; after: { title: string; template: { omitted: boolean; sha256: string; length: number }; logo: { omitted: boolean } }; list: unknown[] };
  assert.equal(d.slug, "posh"); assert.equal(d.version, 2); assert.equal(d.after.title, "POSH");
  assert.deepEqual(Object.keys(d.after.template), ["omitted", "sha256", "length"]);
  assert.equal(d.after.template.length, big.length);
  assert.match(d.after.template.sha256, /^[0-9a-f]{64}$/);
  assert.equal(d.after.logo.omitted, true);
  assert.equal(d.list[0], "short");
  const b = trimDetail(a.detail);
  assert.equal(b.changed, false);
  assert.deepEqual(b.detail, a.detail);
  assert.deepEqual(trimDetail({ a: 1, b: "ok", c: null }), { detail: { a: 1, b: "ok", c: null }, changed: false });
});
