/**
 * One-off, safe on live: stores a placeholder template for every policy version published before templates existed.
 * Only versions with no template (and no PDF) are touched; the published HTML is left as it was for the record.
 * Running it again does nothing. Usage: pnpm db:convert-policies  (add --dry-run to only report)
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, pool, schema as S } from "../db";
import { convertLegacyHtml } from "../../shared/hr/legacyPolicy";
import { logAudit } from "../lib/audit";

const dry = process.argv.includes("--dry-run");
const rows = await db.select({ v: S.policyVersions, slug: S.policies.slug }).from(S.policyVersions)
  .innerJoin(S.policies, eq(S.policies.id, S.policyVersions.policyId))
  .where(and(isNull(S.policyVersions.template), isNull(S.policyVersions.fileId)));
for (const { v, slug } of rows) {
  const r = convertLegacyHtml(v.html);
  console.log(`${slug} v${v.version}: ${r.replaced.length} blanks → placeholders${r.unknownBlanks.length ? `; left as written: ${r.unknownBlanks.join(" | ")}` : ""}`);
  if (dry) continue;
  await db.update(S.policyVersions).set({ template: r.template }).where(and(eq(S.policyVersions.id, v.id), isNull(S.policyVersions.template)));
  await logAudit("system:convert-legacy-policies", "policy.template.convert", "policy", v.policyId, { slug, version: v.version, replaced: r.replaced, unknownBlanks: r.unknownBlanks });
}
console.log(dry ? `dry run: ${rows.length} version(s) would be converted` : `converted ${rows.length} version(s)`);
await new Promise((ok) => setTimeout(ok, 300)); // let audit writes finish
await pool.end();
