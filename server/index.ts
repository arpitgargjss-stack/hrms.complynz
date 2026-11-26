import express, { type Request, type Response, type NextFunction } from "express";
import path from "node:path";
import compression from "compression";
import { env } from "./env";
import { emailConfigured } from "./lib/email";
import { clerkHandler, requireStaff } from "./middleware/auth";
import { HttpError } from "./routes/util";
import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import people, { profileStatus } from "./routes/people";
import payroll from "./routes/payroll";
import reimbursements from "./routes/reimbursements";
import letters from "./routes/letters";
import publicRoutes from "./routes/public";
import time from "./routes/time";
import exits from "./routes/exits";
import feedback from "./routes/feedback";
import dashboard from "./routes/dashboard";
import fnf from "./routes/fnf";
import compliance from "./routes/compliance";
import adminConfig from "./routes/config";
import policyAdmin from "./routes/policyAdmin";
import configMore from "./routes/configMore";
import vibe from "./routes/vibe";
import buzz from "./routes/buzz";
import care from "./routes/care";

const app = express();
app.disable("x-powered-by");
app.use(compression()); // gzip API JSON and the app's JS/CSS (roughly 3x smaller)
// Candidate onboarding sends up to 6 documents in one request as base64 (x4/3), so it gets a larger limit than
// the rest of the API. The client keeps the raw total under 17 MB. Any proxy in front (nginx client_max_body_size)
// must allow at least this much, see docs/engineering/deploy-upload-limits.md.
app.use("/api/public/onboarding", express.json({ limit: "25mb" }));
app.use(express.json({ limit: "12mb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  // Built JS/CSS under /assets have a content hash in their name, so the static handler below caches them for a year.
  // Everything else (API data, index.html) is never cached.
  if (!req.path.startsWith("/assets/")) res.setHeader("Cache-Control", "no-store");
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
        const { row, complete, missing } = await profileStatus(e);
        profile = { fullName: row.fullName, photoFileId: row.photoFileId, complete, missing };
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
app.use("/api", dashboard);
app.use("/api", fnf);
app.use("/api", compliance);
app.use("/api", adminConfig);
app.use("/api", policyAdmin);
app.use("/api", configMore);
app.use("/api", vibe);
app.use("/api", buzz);
app.use("/api", care);

// Unknown API paths answer in JSON so the app shows a readable message instead of a bare "Not Found".
// This usually means the browser has a newer build than the running server: restart the server after deploying.
app.use("/api", (req, res) => {
  res.status(404).json({ error: `The server does not know ${req.method} ${req.originalUrl.split("?")[0]}. If the app was just updated, restart the server so it runs the new code, then try again.` });
});

const dist = path.resolve("dist/client");
app.use("/assets", express.static(path.join(dist, "assets"), { immutable: true, maxAge: "365d", fallthrough: false }));
app.use(express.static(dist, { cacheControl: false }));
app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html"), (e) => e && res.status(404).end()));

app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : err.status ?? 500;
  if (status >= 500) console.error(err);
  const message = status === 413 ? "The upload is too large. Please use smaller files and try again." : err.message;
  res.status(status).json({ error: status >= 500 ? "Something went wrong" : message });
});

app.listen(env.PORT, () => {
  console.log(`HRMS listening on ${env.PORT}`);
  if (!emailConfigured()) console.error("WARNING: RESEND_API_KEY is not set. OTP and notification emails will NOT be sent.");
});
