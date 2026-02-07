import { fileURLToPath } from "node:url";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import * as schema from "./schema.js";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export function createDatabase(url: string) {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const db: Database = drizzle(pool, { schema });
  return { db, close: () => pool.end() };
}

export async function runMigrations(url: string) {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}
