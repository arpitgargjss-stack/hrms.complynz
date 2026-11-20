/**
 * Idempotent demo data. Contains no PII: masked names, reserved-domain emails, fake bank numbers.
 * Run: npm run db:seed   (refuses to run against the production host)
 */
import { eq, like } from "drizzle-orm";
import { db, pool, schema as s } from "../db";
import { env } from "../env";
import { encryptField } from "../lib/crypto";

if (env.HR_APP_URL.startsWith("https://hrms.complynz.com")) throw new Error("Refusing to seed demo data on the production host");
const DEMO = "@demo.invalid";

const existing = await db.select({ id: s.employees.id }).from(s.employees).where(like(s.employees.workEmail, `%${DEMO}`)).limit(1);
if (existing.length) { console.log("Demo data already present; nothing to do."); await pool.end(); process.exit(0); }

const [eng, ops, fin] = await db.insert(s.departments).values([{ name: "Demo Engineering" }, { name: "Demo Operations" }, { name: "Demo Finance" }]).onConflictDoNothing().returning();
const [lead, assoc] = await db.insert(s.designations).values([{ name: "Demo Lead", level: 2 }, { name: "Demo Associate", level: 1 }]).onConflictDoNothing().returning();
const [office] = await db.insert(s.locations).values({ name: "Demo Office", address: "Demo address", lat: "28.6139", lng: "77.2090", radiusM: 150 }).onConflictDoNothing().returning();

const masked = ["A*** K****", "R*** S****", "M*** P****", "S*** V****", "N*** J****", "D*** T****"];
const emps: (typeof s.employees.$inferSelect)[] = [];
for (let i = 0; i < masked.length; i++) {
  const [e]: (typeof s.employees.$inferSelect)[] = await db.insert(s.employees).values({
    code: `CMPZ9${String(i + 1).padStart(2, "0")}`, workEmail: `emp${i + 1}${DEMO}`, fullName: masked[i],
    joiningDate: `202${3 + (i % 3)}-0${1 + (i % 9)}-15`, dob: `199${i}-0${1 + i}-1${i}`,
    departmentId: [eng, ops, fin][i % 3]?.id, designationId: (i === 0 ? lead : assoc)?.id, locationId: office?.id,
    managerId: i === 0 ? null : emps[0].id, status: "active",
    panEnc: encryptField("AAAAA0000A"), bankName: "Demo Bank", accountEnc: encryptField(`00000000${1000 + i}`), ifsc: "DEMO0000001",
  }).returning();
  emps.push(e);
  await db.insert(s.compensation).values({ employeeId: e.id, effectiveFrom: e.joiningDate, monthlyGrossPaise: (40000 + i * 5000) * 100, components: [
    { code: "BASIC", name: "Basic", calc: { type: "percent", of: "gross", bps: 5000 }, pfWage: true },
    { code: "HRA", name: "HRA", calc: { type: "percent", of: "BASIC", bps: 4000 } },
    { code: "SPL", name: "Special Allowance", calc: { type: "balance" } }], reason: "Demo", createdBy: "demo-seed" });
}
await db.insert(s.leaveTypes).values([
  { key: "casual", name: "Casual leave", annualQuotaHalfDays: 24, accrual: "monthly" },
  { key: "sick", name: "Sick leave", annualQuotaHalfDays: 14, accrual: "upfront", requiresNote: true },
  { key: "unpaid", name: "Unpaid leave", annualQuotaHalfDays: 0, paid: false, accrual: "upfront" },
]).onConflictDoNothing();
await db.insert(s.workCalendar).values({ settings: { weeklyOff: [0], saturdays: { mode: "alternate", offWeeks: [2, 4] }, workStart: "10:00", workEnd: "18:30" }, updatedBy: "demo-seed" });
await db.insert(s.holidays).values([{ date: "2026-01-26", name: "Republic Day" }, { date: "2026-08-15", name: "Independence Day" }, { date: "2026-10-02", name: "Gandhi Jayanti" }]).onConflictDoNothing();
await db.insert(s.announcements).values({ title: "Welcome to the demo workspace", body: "Everything here is sample data with masked names.", createdBy: "demo-seed", pinned: true });
await db.insert(s.policies).values({ slug: "demo-leave", title: "Leave policy (demo)" }).onConflictDoNothing();
const [pol] = await db.select().from(s.policies).where(eq(s.policies.slug, "demo-leave"));
await db.insert(s.policyVersions).values({ policyId: pol.id, version: 1, html: "<h1>Leave policy (demo)</h1><p>Sample text only.</p>", publishedBy: "demo-seed" }).onConflictDoNothing();
await db.insert(s.esatCycles).values({ title: "Demo pulse survey", questions: [{ id: "q1", text: "I would recommend this company as a place to work", type: "scale5" }] });
await db.insert(s.assets).values({ tag: "DEMO-LT-001", category: "Laptop", model: "Demo laptop", costPaise: 6500000, condition: "good", status: "in_stock" }).onConflictDoNothing();
console.log(`Seeded ${emps.length} demo employees. Statutory rules are NOT seeded: add them under Payroll after confirming values.`);
await pool.end();
