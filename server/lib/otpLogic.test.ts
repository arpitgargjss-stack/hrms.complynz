import test from "node:test";
import assert from "node:assert/strict";
import { evaluateOtp, canSendOtp, maskEmail, makeSession, checkSession, RateLimiter } from "./otpLogic";

const now = new Date("2026-01-01T10:00:00Z");
const live = { otpHash: "h1", otpExpiresAt: new Date(now.getTime() + 60000), attempts: 0 };

test("otp ok / mismatch / expired / none / locked", () => {
  assert.equal(evaluateOtp(live, "h1", now).result, "ok");
  assert.deepEqual(evaluateOtp(live, "bad", now), { result: "mismatch", attempts: 1 });
  assert.equal(evaluateOtp({ ...live, otpExpiresAt: new Date(now.getTime() - 1) }, "h1", now).result, "expired");
  assert.equal(evaluateOtp({ otpHash: null, otpExpiresAt: null, attempts: 0 }, "h1", now).result, "none");
  assert.equal(evaluateOtp({ ...live, attempts: 5 }, "h1", now).result, "locked");
  assert.equal(evaluateOtp({ ...live, attempts: 4 }, "bad", now).attempts, 5);
});
test("send limit 5 per hour, window slides", () => {
  let sends: number[] = []; const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) { const r = canSendOtp(sends, t0 + i, 5); assert.ok(r.allowed); sends = r.sends; }
  assert.equal(canSendOtp(sends, t0 + 10, 5).allowed, false);
  assert.equal(canSendOtp(sends, t0 + 3600_001 + 4, 5).allowed, true);
});
test("maskEmail", () => {
  assert.equal(maskEmail("john.doe@example.com"), "j***@e***.com");
  assert.equal(maskEmail("a@b.co.in"), "a***@b***.in");
  assert.equal(maskEmail("nonsense"), "***");
});
test("session sign / expiry / tamper", () => {
  const sign = (s: string) => "sig" + s.length + s.slice(-4);
  const s = makeSession("tokhash", 1000, sign, 500);
  assert.ok(checkSession(s, "tokhash", 1200, sign));
  assert.equal(checkSession(s, "tokhash", 1500, sign), false);
  assert.equal(checkSession(s, "other", 1200, sign), false);
  assert.equal(checkSession(undefined, "tokhash", 1200, sign), false);
  assert.equal(checkSession("9999999.x", "tokhash", 1200, sign), false);
});
test("rate limiter", () => {
  const r = new RateLimiter();
  assert.ok(r.hit("k", 2, 1000, 0)); assert.ok(r.hit("k", 2, 1000, 1)); assert.equal(r.hit("k", 2, 1000, 2), false);
  assert.ok(r.hit("k", 2, 1000, 1001));
});
