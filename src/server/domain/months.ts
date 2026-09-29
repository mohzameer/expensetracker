import { and, asc, count, desc, eq, gte, isNull, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { categories, categoryBudgets, categoryMonthSummary, expenses, months, settings, transfers } from "@/db/schema";
import { firstDay, formatDay, formatMonth, lastDay, nextMonthStart } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { UserError } from "@/lib/errors";

export type Month = typeof months.$inferSelect;

export async function getSettings(db: Db) {
  const [row] = await db.select().from(settings).where(eq(settings.id, 1));
  if (row) return row;
  const [created] = await db.insert(settings).values({ id: 1 }).onConflictDoNothing().returning();
  return created ?? (await db.select().from(settings).where(eq(settings.id, 1)))[0];
}

export async function getMonth(db: Db, ym: string): Promise<Month | null> {
  const [row] = await db.select().from(months).where(eq(months.yearMonth, ym));
  return row ?? null;
}

/**
 * Return the month row, creating it on first write. A new month copies the
 * allocations (not leftovers) and alert % of the latest earlier month.
 */
export async function ensureMonth(db: Db, ym: string): Promise<Month> {
  const existing = await getMonth(db, ym);
  if (existing) return existing;

  return db.transaction(async (tx) => {
    const [prior] = await tx.select().from(months).where(lt(months.yearMonth, ym)).orderBy(desc(months.yearMonth)).limit(1);
    const [earliest] = prior ? [prior] : await tx.select().from(months).orderBy(asc(months.yearMonth)).limit(1);
    const source = prior ?? earliest ?? null;
    const s = await getSettings(tx);

    const [month] = await tx
      .insert(months)
      .values({ yearMonth: ym, defaultAlertPct: source?.defaultAlertPct ?? s.defaultAlertPct })
      .onConflictDoNothing()
      .returning();
    if (!month) return (await getMonth(tx, ym))!;

    const cats = await tx.select({ id: categories.id }).from(categories).where(isNull(categories.archivedAt));
    const prev = source
      ? await tx.select().from(categoryBudgets).where(eq(categoryBudgets.monthId, source.id))
      : [];
    const byCat = new Map(prev.map((b) => [b.categoryId, b]));
    if (cats.length) {
      await tx.insert(categoryBudgets).values(
        cats.map((c) => ({
          monthId: month.id,
          categoryId: c.id,
          allocation: byCat.get(c.id)?.allocation ?? 0,
          alertPct: byCat.get(c.id)?.alertPct ?? null,
        })),
      );
    }
    return month;
  });
}

export function assertOpen(month: Month | null, ym?: string) {
  if (month?.status === "closed") {
    throw new UserError(`${formatMonth(month.yearMonth)} is closed and read-only. Log late expenses in the current month.`);
  }
  return ym;
}

export async function assertMonthOpen(db: Db, ym: string) {
  assertOpen(await getMonth(db, ym));
}

/** Lock a month row for the rest of the transaction (serialises money moves). */
export async function lockMonth(db: Db, ym: string): Promise<Month> {
  await ensureMonth(db, ym);
  const [row] = await db.select().from(months).where(eq(months.yearMonth, ym)).for("update");
  return row;
}

export type CloseBlockers = {
  notEnded: boolean;
  earlierOpen: string[];
  uncategorized: number;
  negative: { name: string; remaining: number }[];
};

export async function closeBlockers(db: Db, ym: string, todayStr: string): Promise<CloseBlockers> {
  const month = await getMonth(db, ym);
  const earlier = await db
    .select({ yearMonth: months.yearMonth })
    .from(months)
    .where(and(lt(months.yearMonth, ym), eq(months.status, "open")))
    .orderBy(asc(months.yearMonth));
  const [{ n }] = await db
    .select({ n: count() })
    .from(expenses)
    .where(and(isNull(expenses.categoryId), gte(expenses.spentOn, firstDay(ym)), lt(expenses.spentOn, nextMonthStart(ym))));
  const negative = month
    ? (await db.select().from(categoryMonthSummary).where(eq(categoryMonthSummary.monthId, month.id)))
        .filter((s) => s.remaining < 0)
        .map((s) => ({ name: s.name, remaining: s.remaining }))
    : [];
  return {
    notEnded: todayStr < lastDay(ym),
    earlierOpen: earlier.map((e) => e.yearMonth),
    uncategorized: Number(n),
    negative,
  };
}

/**
 * Close a month: sweep every positive balance into Savings and mark it closed.
 * Everything is re-checked inside the transaction with the month row locked.
 */
export async function closeMonth(db: Db, ym: string, todayStr: string) {
  return db.transaction(async (tx) => {
    const [month] = await tx.select().from(months).where(eq(months.yearMonth, ym)).for("update");
    if (!month) throw new UserError(`Nothing has been recorded for ${formatMonth(ym)}.`);
    if (month.status === "closed") throw new UserError(`${formatMonth(ym)} is already closed.`);

    const b = await closeBlockers(tx, ym, todayStr);
    if (b.notEnded) throw new UserError(`${formatMonth(ym)} can be closed from ${formatDay(lastDay(ym))}.`);
    if (b.earlierOpen.length) throw new UserError(`Close ${formatMonth(b.earlierOpen[0])} first.`);
    if (b.uncategorized) throw new UserError(`Assign a category to ${b.uncategorized} expense(s) first.`);
    if (b.negative.length) {
      throw new UserError(`Cover ${b.negative.map((n) => `${n.name} (${formatMoney(n.remaining)})`).join(", ")} first.`);
    }

    const summaries = await tx.select().from(categoryMonthSummary).where(eq(categoryMonthSummary.monthId, month.id));
    const sweeps = summaries.filter((s) => s.remaining > 0);
    if (sweeps.length) {
      await tx.insert(transfers).values(
        sweeps.map((s) => ({
          monthId: month.id,
          fromKind: "category" as const,
          fromCategoryId: s.categoryId,
          toKind: "savings" as const,
          amount: s.remaining,
          reason: "month_close" as const,
          note: `${formatMonth(ym, { month: "long" })} leftovers`,
          occurredOn: lastDay(ym),
        })),
      );
    }
    await tx.update(months).set({ status: "closed", closedAt: new Date() }).where(eq(months.id, month.id));
    return { swept: sweeps.reduce((a, s) => a + s.remaining, 0) };
  });
}
