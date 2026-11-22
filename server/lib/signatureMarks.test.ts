import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultStampUri, marksHtml } from "./signatureMarks";

test("default stamp is the bundled company stamp image", () => {
  const uri = defaultStampUri();
  assert.ok(uri && uri.startsWith("data:image/png;base64,iVBOR"));
});

test("no uploaded signature: the signatory's name in handwriting plus the stamp; uploads win", () => {
  const def = marksHtml({ stampUri: "data:image/png;base64,STAMP", signatureUri: null, stampIsDefault: true, signatureIsDefault: true }, "Riya <Sharma>");
  assert.match(def, /class="sig-cursive"[^>]*>Riya &lt;Sharma&gt;</);
  assert.match(def, /class="sig-stamp" src="data:image\/png;base64,STAMP"/);
  const up = marksHtml({ stampUri: "data:image/png;base64,MINE", signatureUri: "data:image/png;base64,SIG", stampIsDefault: false, signatureIsDefault: false }, "Riya");
  assert.match(up, /class="sig-img" src="data:image\/png;base64,SIG"/);
  assert.doesNotMatch(up, /sig-cursive/);
  assert.equal(marksHtml(null, "Riya"), "");
});
