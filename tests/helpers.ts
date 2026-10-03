import { createDb, migrateDb, type Db } from "@/db/client";
import { items } from "@/db/schema";
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
  const groceries = await createCategory(db, { name: "Groceries", ym: "2026-09" });
  const dining = await createCategory(db, { name: "Dining", ym: "2026-09" });
  const utilities = await createCategory(db, { name: "Utilities", ym: "2026-09" });
  // Caps are the totals of a category's items: Groceries 30,000 · Dining 12,000 · Utilities 18,000.
  const monthly = (categoryId: string, name: string, amount: number) =>
    createItem(db, { categoryId, name, kind: "monthly", expectedAmount: rs(amount), ym: "2026-09" });
  const shop = await monthly(groceries.id, "Shop", 30000);
  const meals = await monthly(dining.id, "Meals", 12000);
  const internet = await monthly(utilities.id, "Internet", 3990);
  const power = await monthly(utilities.id, "Power", 14010);
  // Items only count as due in months after they were created; pin them to September
  // so the tests don't depend on today's date.
  await db.update(items).set({ createdAt: new Date("2026-09-01T00:00:00Z") });
  const expense = (categoryId: string | null, amount: number, spentOn = "2026-09-10", itemId: string | null = null) =>
    createExpense(db, { spentOn, categoryId, itemId, amount, note: null });
  return { groceries, dining, utilities, shop, meals, internet, power, expense };
}
