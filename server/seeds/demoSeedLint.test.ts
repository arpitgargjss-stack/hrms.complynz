import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("demo seeder has no real-looking PII", () => {
  const src = readFileSync(new URL("./run.ts", import.meta.url), "utf8");
  assert.ok(!/@gmail\.|@yahoo\.|@outlook\.|@complynz\.com/i.test(src.replace(/`[^`]*@complynz\.com[^`]*`/g, "")), "real email domain in seeder");
  assert.ok(!/\b[6-9]\d{9}\b/.test(src), "phone-like number in seeder");
  assert.ok(src.includes("Refusing to seed demo data on the production host"));
});
