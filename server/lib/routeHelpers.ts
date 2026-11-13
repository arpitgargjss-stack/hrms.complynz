import type { Request } from "express";
import { z } from "zod";
import { HttpError } from "../routes/util";
import { scopeFor, type Capability, type Scope } from "../../shared/hr/access";

export function param(req: Request, k: string): string { const v = req.params[k]; return Array.isArray(v) ? v[0] ?? "" : String(v ?? ""); }
export function idParam(req: Request, k = "id"): string {
  const v = param(req, k);
  if (!z.string().uuid().safeParse(v).success) throw new HttpError(404, "Not found");
  return v;
}
/** Date in Asia/Kolkata as YYYY-MM-DD. */
export function istDate(d = new Date()): string { return new Date(d.getTime() + 19_800_000).toISOString().slice(0, 10); }
export const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(s + "T00:00:00Z")) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s, "Invalid date");
export const monthStr = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** Resolve the actor's scope for a capability; 403 when none (or below `min`). */
export function need(req: Request, cap: Capability, ...allowed: Scope[]): Scope {
  if (!req.actor) throw new HttpError(401, "Sign in required");
  const s = scopeFor(req.actor.roles, cap);
  if (s === "none" || (allowed.length && !allowed.includes(s))) throw new HttpError(403, "Not allowed");
  return s;
}
export function isHr(req: Request): boolean { return !!req.actor?.roles.has("hr_admin"); }
export function requireHr(req: Request): void { if (!isHr(req)) throw new HttpError(403, "Not allowed"); }
export function selfId(req: Request): string {
  const id = req.actor?.employeeId;
  if (!id) throw new HttpError(403, "No employee record is linked to this login");
  return id;
}
export function addDays(date: string, n: number): string { const d = new Date(date + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

import { parse } from "../routes/util";
/** zod parse() that keeps the schema's output type (defaults, transforms). */
export function parseOut<S extends z.ZodTypeAny>(schema: S, data: unknown): z.output<S> { return parse(schema as unknown as z.ZodType<z.output<S>>, data); }
