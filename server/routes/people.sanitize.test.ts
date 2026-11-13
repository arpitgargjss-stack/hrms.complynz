import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeHtml } from "../lib/sanitizeHtml";

test("strips script blocks and unclosed scripts", () => {
  assert.equal(sanitizeHtml("<p>a</p><script>alert(1)</script><p>b</p>"), "<p>a</p><p>b</p>");
  assert.ok(!/script/i.test(sanitizeHtml("<p>x</p><script src=x>")));
  assert.ok(!/script/i.test(sanitizeHtml("<scr<script>ipt>alert(1)</scr</script>ipt>")));
});
test("strips event handler attributes", () => {
  const out = sanitizeHtml(`<a href="/x" onclick="steal()" ONMOUSEOVER='x()'>t</a><img/onerror=alert(1) src=a.png>`);
  assert.ok(!/on(click|mouseover|error)/i.test(out), out);
  assert.ok(out.includes('href="/x"'));
});
test("neutralises javascript: urls including obfuscated", () => {
  assert.ok(!/javascript/i.test(sanitizeHtml(`<a href="javascript:alert(1)">x</a>`)));
  assert.ok(!/javascript/i.test(sanitizeHtml(`<a href="  JaVa\tScRiPt:alert(1)">x</a>`)));
  assert.ok(!/javascript/i.test(sanitizeHtml(`<a href="&#106;avascript:alert(1)">x</a>`)));
  assert.ok(!/data:text/i.test(sanitizeHtml(`<a href='data:text/html;base64,AAAA'>x</a>`)));
});
test("keeps ordinary markup and safe links", () => {
  const ok = `<h2>Leave</h2><ul><li>One <b>two</b></li></ul><a href="https://complynz.com/x" target="_blank">site</a>`;
  assert.equal(sanitizeHtml(ok), ok);
});
test("removes iframes", () => {
  assert.ok(!/iframe/i.test(sanitizeHtml(`<iframe src="https://evil.example"></iframe>ok`)));
});
