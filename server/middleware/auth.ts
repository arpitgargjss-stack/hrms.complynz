import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { env } from "../env";
import { clerkMiddleware, getAuth, clerkClient } from "@clerk/express";
import type { Role } from "../../shared/hr/access";

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
    const [emp] = await db.select().from(schema.employees).where(eq(schema.employees.workEmail, email)).limit(1);
    const roleRows = await db.select().from(schema.userRoles).where(eq(schema.userRoles.email, email));
    const roles = new Set<Role>(["team_member", ...roleRows.map((r) => r.role as Role)]);
    let directReportIds: string[] = [];
    if (emp) {
      const reports = await db.select({ id: schema.employees.id }).from(schema.employees).where(eq(schema.employees.managerId, emp.id));
      directReportIds = reports.map((r) => r.id);
      if (directReportIds.length) roles.add("manager");
    }
    req.actor = { email, employeeId: emp?.id ?? null, roles, directReportIds };
    next();
  } catch (e) { next(e); }
}

export function requireRole(...allowed: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.actor || !allowed.some((r) => req.actor!.roles.has(r))) return res.status(403).json({ error: "Not allowed" });
    next();
  };
}
