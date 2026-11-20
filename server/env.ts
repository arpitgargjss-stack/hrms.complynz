import "dotenv/config";
import { z } from "zod";
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().default(5100),
  HR_APP_URL: z.string().default("https://hrms.complynz.com"),
  STAFF_EMAIL_DOMAIN: z.string().default("complynz.com"),
  FILE_STORAGE_DIR: z.string().default("./storage"),
  FIELD_ENCRYPTION_KEY: z.string().min(32),
  HMAC_PEPPER: z.string().min(16),
  CLERK_PUBLISHABLE_KEY: z.string().optional(),
  CLERK_SECRET_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("hr@complynz.com"),
  CMP_BASE_URL: z.string().optional(),
  CMP_PROPERTY_KEY: z.string().optional(),
  CMP_API_KEY: z.string().optional(),
  AUTH_MODE: z.enum(["clerk", "dev"]).default("clerk"),
  DEV_AUTH_EMAIL: z.string().optional(),
});
export const env = schema.parse(process.env);
if (env.AUTH_MODE === "dev" && env.HR_APP_URL.startsWith("https://hrms.complynz.com")) {
  throw new Error("AUTH_MODE=dev is not allowed against the production host");
}
