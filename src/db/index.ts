import "server-only";
import { createDb, type Db } from "./client";

// One client per server process. `DATABASE_URL` is a Neon (Postgres) URL, or
// `pglite://<dir>` for a zero-setup local database during development.
const globalForDb = globalThis as unknown as { db?: Promise<Db> };

export function getDb(): Promise<Db> {
  globalForDb.db ??= createDb(process.env.DATABASE_URL);
  return globalForDb.db;
}

export type { Db } from "./client";
