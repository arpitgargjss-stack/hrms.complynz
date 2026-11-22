import { test } from "node:test";
import assert from "node:assert/strict";
import { createIdentityCache } from "./identityCache";

test("looks each user up once within the TTL and never mixes users", async () => {
  let t = 0; const calls: string[] = [];
  const emails: Record<string, string | null> = { u1: "a@complynz.com", u2: "b@complynz.com" };
  const c = createIdentityCache(async (id) => { calls.push(id); return emails[id] ?? null; }, { ttlMs: 1000, now: () => t });
  assert.equal(await c.get("u1"), "a@complynz.com");
  assert.equal(await c.get("u2"), "b@complynz.com");
  assert.equal(await c.get("u1"), "a@complynz.com");
  assert.deepEqual(calls, ["u1", "u2"]);
});

test("an email change is picked up after the TTL", async () => {
  let t = 0, email = "old@complynz.com";
  const c = createIdentityCache(async () => email, { ttlMs: 1000, now: () => t });
  assert.equal(await c.get("u1"), "old@complynz.com");
  email = "new@complynz.com"; t = 999;
  assert.equal(await c.get("u1"), "old@complynz.com");
  t = 1000;
  assert.equal(await c.get("u1"), "new@complynz.com");
});

test("no verified email is not cached, so verifying works on the next request", async () => {
  let email: string | null = null, n = 0;
  const c = createIdentityCache(async () => { n++; return email; });
  assert.equal(await c.get("u1"), null);
  email = "a@complynz.com";
  assert.equal(await c.get("u1"), "a@complynz.com");
  assert.equal(n, 2);
});

test("concurrent requests for one user share a single lookup; failures are not cached", async () => {
  let n = 0, fail = true;
  const c = createIdentityCache(async () => { n++; await new Promise((r) => setTimeout(r, 5)); if (fail) throw new Error("clerk down"); return "a@complynz.com"; });
  const rs = await Promise.allSettled([c.get("u1"), c.get("u1"), c.get("u1")]);
  assert.equal(n, 1); assert.ok(rs.every((r) => r.status === "rejected"));
  fail = false;
  assert.equal(await c.get("u1"), "a@complynz.com");
  assert.equal(n, 2);
});

test("forget drops a cached entry", async () => {
  let n = 0;
  const c = createIdentityCache(async () => { n++; return "a@complynz.com"; });
  await c.get("u1"); c.forget("u1"); await c.get("u1");
  assert.equal(n, 2);
});
