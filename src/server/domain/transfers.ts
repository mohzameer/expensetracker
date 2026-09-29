import { and, eq, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { categoryBudgets, categoryMonthSummary, months, savingsBalance, settings, transfers } from "@/db/schema";
import { clampToMonth, currentYearMonth, monthOf } from "@/lib/dates";
import { UserError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { assertOpen, lockMonth } from "./months";

/**
 * Free savings: everything that came into Savings (income, deposits, month-end
 * leftovers) minus what went out (covers, withdrawals) minus the budgets of every
 * month up to `ym` — budgets are paid out of Savings. A closed month nets out to
 * minus what was actually spent.
 */
export async function getSavingsBalance(db: Db, ym: string = currentYearMonth()): Promise<number> {
  const [row] = await db.select().from(savingsBalance);
  const [committed] = await db
    .select({ total: sql<number>`coalesce(sum(${categoryBudgets.allocation}), 0)::bigint`.mapWith(Number) })
    .from(categoryBudgets)
    .innerJoin(months, eq(months.id, categoryBudgets.monthId))
    .where(lte(months.yearMonth, ym));
  return (row?.balance ?? 0) - (committed?.total ?? 0);
}

/** Serialise everything that spends Savings (it spans months). */
async function lockSavings(db: Db) {
  await db.select({ id: settings.id }).from(settings).where(eq(settings.id, 1)).for("update");
}

export type TransferSource = { kind: "category"; categoryId: string } | { kind: "savings" };

/**
 * Move money into a category within one month — a Cover for an overspend, or a
 * manual move from Savings. The source can never be taken below zero.
 */
export async function moveToCategory(
  db: Db,
  input: {
    ym: string;
    toCategoryId: string;
    source: TransferSource;
    amount: number;
    todayStr: string;
    reason?: "cover" | "manual";
    note?: string | null;
  },
) {
  return db.transaction(async (tx) => {
    const month = await lockMonth(tx, input.ym);
    assertOpen(month);

    if (input.source.kind === "category") {
      if (input.source.categoryId === input.toCategoryId) throw new UserError("Pick a different category to take it from.");
      const [src] = await tx
        .select()
        .from(categoryMonthSummary)
        .where(and(eq(categoryMonthSummary.monthId, month.id), eq(categoryMonthSummary.categoryId, input.source.categoryId)));
      const available = Math.max(src?.remaining ?? 0, 0);
      if (available < input.amount) {
        throw new UserError(`Only ${formatMoney(available)} is left in ${src?.name ?? "that category"}.`);
      }
    } else {
      await lockSavings(tx);
      const balance = await getSavingsBalance(tx, monthOf(input.todayStr));
      if (balance < input.amount) throw new UserError(`Savings only has ${formatMoney(Math.max(balance, 0))} free.`);
    }

    const [row] = await tx
      .insert(transfers)
      .values({
        monthId: month.id,
        fromKind: input.source.kind,
        fromCategoryId: input.source.kind === "category" ? input.source.categoryId : null,
        toKind: "category",
        toCategoryId: input.toCategoryId,
        amount: input.amount,
        reason: input.reason ?? "cover",
        note: input.note ?? null,
        occurredOn: clampToMonth(input.todayStr, input.ym),
      })
      .returning();
    return row;
  });
}

/** Manual Savings adjustment: a starting balance, a deposit or a withdrawal. */
export async function adjustSavings(
  db: Db,
  input: { direction: "in" | "out"; amount: number; note: string | null; todayStr: string },
) {
  const ym = monthOf(input.todayStr) || currentYearMonth();
  return db.transaction(async (tx) => {
    const month = await lockMonth(tx, ym);
    assertOpen(month);
    await lockSavings(tx);
    if (input.direction === "out") {
      const balance = await getSavingsBalance(tx, ym);
      if (balance < input.amount) throw new UserError(`Savings only has ${formatMoney(Math.max(balance, 0))} free.`);
    }
    const [row] = await tx
      .insert(transfers)
      .values({
        monthId: month.id,
        fromKind: input.direction === "in" ? "external" : "savings",
        toKind: input.direction === "in" ? "savings" : "external",
        amount: input.amount,
        reason: "manual",
        note: input.note,
        occurredOn: input.todayStr,
      })
      .returning();
    return row;
  });
}
