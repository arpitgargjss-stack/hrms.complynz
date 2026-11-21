import express, { type Request, type Response, type NextFunction } from "express";
import path from "node:path";
import { env } from "./env";
import { clerkHandler, requireStaff } from "./middleware/auth";
import { HttpError } from "./routes/util";
import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import people, { markProfileIfComplete } from "./routes/people";
import { missingProfileFields } from "../shared/hr/profile";
import payroll from "./routes/payroll";
import reimbursements from "./routes/reimbursements";
import letters from "./routes/letters";
import publicRoutes from "./routes/public";
import time from "./routes/time";
import exits from "./routes/exits";
import feedback from "./routes/feedback";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "12mb" }));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.get("/healthz", (_req, res) => res.json({ ok: true }));

// Public token + OTP routes (candidate acceptance, onboarding). Outside the staff gate on purpose.
app.use("/api/public", publicRoutes);

// Everything else requires a verified staff login.
app.use("/api", clerkHandler, requireStaff);
app.get("/api/me", async (req, res, next) => {
  try {
    const a = req.actor!;
    let profile: { fullName: string; photoFileId: string | null; complete: boolean; missing: string[] } | null = null;
    if (a.employeeId) {
      const [e] = await db.select().from(schema.employees).where(eq(schema.employees.id, a.employeeId)).limit(1);
      if (e) {
        const row = await markProfileIfComplete(e);
        profile = { fullName: row.fullName, photoFileId: row.photoFileId, complete: !!row.profileCompletedAt, missing: missingProfileFields(row) };
      }
    }
    res.json({ email: a.email, employeeId: a.employeeId, roles: [...a.roles], profile });
  } catch (e) { next(e); }
});
app.use("/api", people);
app.use("/api", payroll);
app.use("/api", reimbursements);
app.use("/api", letters);
app.use("/api", time);
app.use("/api", exits);
app.use("/api", feedback);

const dist = path.resolve("dist/client");
app.use(express.static(dist));
app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html"), (e) => e && res.status(404).end()));

app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : err.status ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? "Something went wrong" : err.message });
});

app.listen(env.PORT, () => console.log(`HRMS listening on ${env.PORT}`));
