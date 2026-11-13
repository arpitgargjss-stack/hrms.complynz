import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { ZodSchema } from "zod";
export const wrap = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req, res, next: NextFunction) => { fn(req, res).catch(next); };
export function parse<T>(schema: ZodSchema<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) { const e = new Error("Invalid input: " + r.error.issues.map((i) => i.path.join(".") + " " + i.message).join("; ")) as Error & { status?: number }; e.status = 400; throw e; }
  return r.data;
}
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
