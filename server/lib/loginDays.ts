import { and, desc, eq, lt } from "drizzle-orm";
import { db, schema } from "../db";
import { addDays, istDate } from "./routeHelpers";

export const LOGIN_PURPOSE = "login_activity";
/** employeeId -> IST day already handled, so each person costs at most one consent lookup per day. */
const seen = new Map<string, string>();
let purgedOn = "";

/** Record that this person used the app today, only if their latest login_activity consent is "granted". Never throws. */
export async function noteLogin(employeeId: string): Promise<void> {
  const day = istDate();
  if (seen.get(employeeId) === day) return;
  seen.set(employeeId, day);
  try {
    if (purgedOn !== day) { purgedOn = day; await db.delete(schema.loginDays).where(lt(schema.loginDays.day, addDays(day, -400))); } // rolling 13 months
    const [ev] = await db.select({ status: schema.consentEvents.status }).from(schema.consentEvents)
      .where(and(eq(schema.consentEvents.subjectId, "emp_" + employeeId), eq(schema.consentEvents.purposeKey, LOGIN_PURPOSE)))
      .orderBy(desc(schema.consentEvents.at)).limit(1);
    if (ev?.status !== "granted") return;
    await db.insert(schema.loginDays).values({ employeeId, day }).onConflictDoNothing();
  } catch { seen.delete(employeeId); }
}

/** Called when consent changes. Withdrawal deletes everything recorded for the person. */
export async function onLoginConsent(employeeId: string, granted: boolean): Promise<void> {
  seen.delete(employeeId);
  if (!granted) await db.delete(schema.loginDays).where(eq(schema.loginDays.employeeId, employeeId));
  else void noteLogin(employeeId);
}
