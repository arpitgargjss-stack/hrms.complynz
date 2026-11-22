import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { env } from "../env";
// Keep idle connections for 10 minutes (the pg default is 10 seconds), so the first click after a quiet spell
// does not pay for a fresh TCP + TLS + login handshake to the database. keepAlive stops idle sockets being dropped.
// max 15 leaves room for endpoints that run their queries in parallel.
export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 15, idleTimeoutMillis: 10 * 60_000, keepAlive: true });
// An idle connection the network drops must not crash the server; the pool just opens a new one next time.
pool.on("error", (e) => console.error("idle database connection closed:", e.message));
export const db = drizzle(pool, { schema });
export { schema };
