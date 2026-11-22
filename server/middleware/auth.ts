import type { Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db, schema } from "../db";
import { env } from "../env";
import { clerkMiddleware, getAuth, clerkClient } from "@clerk/express";
import { SUPER_ADMIN_IMPLIES, type Role } from "../../shared/hr/access";
import { noteLogin } from "../lib/loginDays";

export interface Actor {
  email: string; employeeId: string | null; roles: Set<Role>; directReportIds: string[];
}
declare global { namespace Express { interface Request { actor?: Actor } } }

export const clerkHandler = env.AUTH_MODE === "clerk" ? clerkMiddleware() : (_req: Request, _res: Response, next: NextFunction) => next();

async function emailFromRequest(req: Request): Promise<string | null> {
  if (env.AUTH_MODE === "dev") return env.DEV_AUTH_EMAIL?.toLowerCase() ?? null;
  const a = getAuth(req);
  if (!a.userId) return null;
  const u = await clerkClient.users.getUser(a.userId);
  const primary = u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId);
  if (!primary || primary.verification?.status !== "verified") return null;
  return primary.emailAddress.toLowerCase();
}

/** Staff gate: verified @complynz.com email only. Resolves the actor and roles. */
export async function requireStaff(req: Request, res: Response, next: NextFunction) {
  try {
    const email = await emailFromRequest(req);
    if (!email) return res.status(401).json({ error: "Sign in required" });
    if (!email.endsWith("@" + env.STAFF_EMAIL_DOMAIN)) return res.status(403).json({ error: "Staff accounts only" });
    // One round trip for the employee, their roles and their direct reports (previously three queries in a row).
    const { rows: [who] } = await db.execute<{ emp_id: string | null; roles: string[]; reports: string[] }>(sql`
      select e.id::text as emp_id,
        (select coalesce(array_agg(r.role), '{}'::text[]) from ${schema.userRoles} r where r.email = ${email}) as roles,
        (select coalesce(array_agg(m.id::text), '{}'::text[]) from ${schema.employees} m where m.manager_id = e.id) as reports
      from (select 1) one
      left join lateral (select x.id from ${schema.employees} x where x.work_email = ${email} limit 1) e on true`);
    const emp = who?.emp_id ? { id: who.emp_id } : null;
    const roles = new Set<Role>(["team_member", ...(who?.roles ?? []).map((r) => r as Role)]);
    if (roles.has("super_admin")) for (const r of SUPER_ADMIN_IMPLIES) roles.add(r);
    let directReportIds: string[] = [];
    if (emp) {
      directReportIds = who.reports ?? [];
      if (directReportIds.length) roles.add("manager");
    }
    req.actor = { email, employeeId: emp?.id ?? null, roles, directReportIds };
    if (emp) void noteLogin(emp.id);
    next();
  } catch (e) { next(e); }
}

export function requireRole(...allowed: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.actor || !allowed.some((r) => req.actor!.roles.has(r))) return res.status(403).json({ error: "Not allowed" });
    next();
  };
}
