import { createDb, migrateDb, type Db } from "@/db/client";
import { createCategory, createItem } from "@/server/domain/catalog";
import { ensureMonth } from "@/server/domain/months";
import { createExpense } from "@/server/domain/expenses";

/** A fresh in-memory Postgres (PGlite) with the real migrations applied. */
export async function freshDb(): Promise<Db> {
  const db = await createDb("pglite://memory");
  await migrateDb(db, "pglite://memory");
  return db;
}

export const rs = (n: number) => n * 100;

export async function seedSeptember(db: Db) {
  await ensureMonth(db, "2026-09");
  const groceries = await createCategory(db, { name: "Groceries", allocation: rs(30000), ym: "2026-09" });
  const dining = await createCategory(db, { name: "Dining", allocation: rs(12000), ym: "2026-09" });
  const utilities = await createCategory(db, { name: "Utilities", allocation: rs(18000), ym: "2026-09" });
  const internet = await createItem(db, { categoryId: utilities.id, name: "Internet", kind: "monthly", expectedAmount: rs(3990) });
  const expense = (categoryId: string | null, amount: number, spentOn = "2026-09-10", itemId: string | null = null) =>
    createExpense(db, { spentOn, categoryId, itemId, amount, note: null });
  return { groceries, dining, utilities, internet, expense };
}
