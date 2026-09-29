import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

const casing = "snake_case" as const;

export async function createDb(url: string | undefined): Promise<Db> {
  if (!url) throw new Error("DATABASE_URL is not set");

  if (url.startsWith("pglite://")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const dir = url.slice("pglite://".length);
    if (dir !== "memory") (await import("node:fs")).mkdirSync(dir, { recursive: true });
    const client = dir === "memory" ? new PGlite() : new PGlite(dir);
    return drizzle({ client, schema, casing }) as unknown as Db;
  }

  const { Pool, neonConfig } = await import("@neondatabase/serverless");
  const { drizzle } = await import("drizzle-orm/neon-serverless");
  if (typeof WebSocket === "undefined") {
    neonConfig.webSocketConstructor = (await import("ws")).default;
  }
  const pool = new Pool({ connectionString: url });
  return drizzle({ client: pool, schema, casing }) as unknown as Db;
}

export async function migrateDb(db: Db, url: string, migrationsFolder = "drizzle") {
  if (url.startsWith("pglite://")) {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(db as any, { migrationsFolder });
  } else {
    const { migrate } = await import("drizzle-orm/neon-serverless/migrator");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(db as any, { migrationsFolder });
  }
}
