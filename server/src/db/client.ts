import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema.js";

let pool: Pool | undefined;

export function getDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }

  pool ??= new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  });

  return drizzle(pool, { schema });
}