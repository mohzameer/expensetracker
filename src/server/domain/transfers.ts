import { and, eq, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { categoryMonthSummary, months, settings, transfers } from "@/db/schema";
import { totalBalance } from "./accounts";
import { clampToRange } from "@/lib/dates";
import { UserError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { assertOpen, currentYm, lockMonth, monthOfDate } from "./months";

/**
 * Free money: what's in your accounts, minus what's still unspent in the budgets
 * of open months up to `ym` (that money is spoken for). Covers "from Savings" raise
 * a budget, so they lower this too.
 */
export async function getSavingsBalance(db: Db, ym?: string): Promise<number> {
  ym ??= await currentYm(db);
  const [committed] = await db
    .select({ total: sql<number>`coalesce(sum(greatest(${categoryMonthSummary.remaining}, 0)), 0)::bigint`.mapWith(Number) })
    .from(categoryMonthSummary)
    .innerJoin(months, eq(months.id, categoryMonthSummary.monthId))
    .where(and(eq(months.status, "open"), lte(months.yearMonth, ym)));
  return (await totalBalance(db)) - (committed?.total ?? 0);
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
      const balance = await getSavingsBalance(tx, await monthOfDate(tx, input.todayStr));
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
        occurredOn: clampToRange(input.todayStr, { from: month.startsOn, to: month.endsOn }),
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
  const ym = await monthOfDate(db, input.todayStr);
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
