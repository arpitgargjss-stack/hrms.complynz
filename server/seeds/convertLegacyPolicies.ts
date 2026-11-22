/**
 * Links old policy blanks to Configuration fields. Safe on live: only versions with no template (and no PDF) are
 * written, and only on a real run; the published HTML is kept for the record. Running it again does nothing.
 *
 *   pnpm db:convert-policies --dry-run              report every policy and version, change nothing
 *   pnpm db:convert-policies                        store templates for versions that have none
 *   pnpm db:convert-policies --dry-run --file a.html b.html   report on policy files instead of the database
 */
import { readFileSync } from "node:fs";
import { and, eq, isNull } from "drizzle-orm";
import { convertLegacyHtml, legacyBlanks, type LegacyResult } from "../../shared/hr/legacyPolicy";

const dry = process.argv.includes("--dry-run");
const fileArgs = process.argv.includes("--file") ? process.argv.slice(process.argv.indexOf("--file") + 1).filter((a) => !a.startsWith("--")) : [];

export function report(name: string, r: LegacyResult): string {
  const lines = [`\n${name}: ${r.replaced.length} linked, ${r.unmatched.length} left as written`];
  for (const x of r.replaced) lines.push(`  linked     [${x.blank}] → {{${x.key}}}   (${x.context.slice(0, 70)})`);
  for (const x of r.unmatched) lines.push(`  NOT LINKED [${x.blank}]: ${x.reason}   (${x.context.slice(0, 70)})`);
  return lines.join("\n");
}

if (fileArgs.length) {
  for (const f of fileArgs) console.log(report(f, convertLegacyHtml(readFileSync(f, "utf8"))));
} else {
  const { db, pool, schema: S } = await import("../db");
  const { logAudit } = await import("../lib/audit");
  const rows = await db.select({ v: S.policyVersions, slug: S.policies.slug }).from(S.policyVersions)
    .innerJoin(S.policies, eq(S.policies.id, S.policyVersions.policyId)).where(isNull(S.policyVersions.fileId));
  let todo = 0;
  for (const { v, slug } of rows) {
    if (v.template) {
      // Drafts made from an old policy may still carry blanks: report them so HR can use "Convert blanks to fields".
      const left = legacyBlanks(v.template);
      console.log(`\n${slug} v${v.version} (${v.status}, has template): ${left.length ? `${left.length} blank(s) not linked: ${left.map((b) => `[${b}]`).join(", ")} — open it and use "Convert blanks to fields"` : "nothing to do"}`);
      continue;
    }
    const r = convertLegacyHtml(v.html);
    todo++;
    console.log(report(`${slug} v${v.version} (${v.status}, no template)`, r));
    if (dry) continue;
    await db.update(S.policyVersions).set({ template: r.template }).where(and(eq(S.policyVersions.id, v.id), isNull(S.policyVersions.template)));
    await logAudit("system:convert-legacy-policies", "policy.template.convert", "policy", v.policyId, { slug, version: v.version, linked: r.replaced.length, notLinked: r.unmatched.map((u) => u.blank) });
  }
  console.log(`\n${dry ? "dry run: would store templates for" : "stored templates for"} ${todo} version(s)`);
  await new Promise((ok) => setTimeout(ok, 300));
  await pool.end();
}
