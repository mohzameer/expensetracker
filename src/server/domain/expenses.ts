import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { categoryMonthSummary, expenses, items } from "@/db/schema";
import { UserError } from "@/lib/errors";
import { stateAfter } from "@/lib/budget";
import { assertOpen, ensureMonth, getMonth, monthOfDate } from "./months";

export type ExpenseInput = {
  spentOn: string;
  categoryId: string | null;
  itemId: string | null;
  amount: number;
  note: string | null;
  /** Which account paid; null only for expenses from before accounts existed. */
  accountId?: string | null;
};

async function checkItem(db: Db, input: ExpenseInput) {
  if (!input.itemId) return;
  if (!input.categoryId) throw new UserError("Pick a category before an item.");
  const [item] = await db.select().from(items).where(and(eq(items.id, input.itemId), eq(items.categoryId, input.categoryId)));
  if (!item) throw new UserError("That item doesn't belong to the chosen category.");
}

/** The category's authoritative balance after a save, for the response. */
export async function categoryState(db: Db, categoryId: string | null, ym: string) {
  if (!categoryId) return null;
  const month = await getMonth(db, ym);
  if (!month) return null;
  const [s] = await db
    .select()
    .from(categoryMonthSummary)
    .where(and(eq(categoryMonthSummary.monthId, month.id), eq(categoryMonthSummary.categoryId, categoryId)));
  if (!s) return null;
  return { name: s.name, remaining: s.remaining, effectiveAllocation: s.effectiveAllocation, ...stateAfter(s, 0) };
}

export async function createExpense(db: Db, input: ExpenseInput) {
  const ym = await monthOfDate(db, input.spentOn);
  assertOpen(await ensureMonth(db, ym));
  await checkItem(db, input);
  const [row] = await db.insert(expenses).values(input).returning();
  return { expense: row, category: await categoryState(db, row.categoryId, ym) };
}

export async function updateExpense(db: Db, id: string, input: ExpenseInput) {
  const [old] = await db.select().from(expenses).where(eq(expenses.id, id));
  if (!old) throw new UserError("That expense no longer exists.");
  assertOpen(await getMonth(db, await monthOfDate(db, old.spentOn)));
  const ym = await monthOfDate(db, input.spentOn);
  assertOpen(await ensureMonth(db, ym));
  await checkItem(db, input);
  const [row] = await db.update(expenses).set({ ...input, updatedAt: new Date() }).where(eq(expenses.id, id)).returning();
  return { expense: row, category: await categoryState(db, row.categoryId, ym) };
}

export async function deleteExpense(db: Db, id: string) {
  const [old] = await db.select().from(expenses).where(eq(expenses.id, id));
  if (!old) return;
  assertOpen(await getMonth(db, await monthOfDate(db, old.spentOn)));
  await db.delete(expenses).where(eq(expenses.id, id));
}

/** Needs-category inbox: give an uncategorised expense a category. */
export async function assignCategory(db: Db, id: string, categoryId: string) {
  const [old] = await db.select().from(expenses).where(eq(expenses.id, id));
  if (!old) throw new UserError("That expense no longer exists.");
  const ym = await monthOfDate(db, old.spentOn);
  assertOpen(await ensureMonth(db, ym));
  await db.update(expenses).set({ categoryId, itemId: null, updatedAt: new Date() }).where(eq(expenses.id, id));
  return categoryState(db, categoryId, ym);
}
