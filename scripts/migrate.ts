import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import { createDb, migrateDb } from "../src/db/client";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  const db = await createDb(url);
  await migrateDb(db, url);
  console.log("Migrations applied.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
