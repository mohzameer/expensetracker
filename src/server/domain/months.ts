import { and, asc, count, desc, eq, gt, gte, isNull, lt, lte } from "drizzle-orm";
import type { Db } from "@/db/client";
import { categories, categoryBudgets, categoryMonthSummary, expenses, incomes, months, settings, transfers } from "@/db/schema";
import { addDays, addMonths, formatDay, formatMonth, periodEnd, periodOf, periodStart, today, type Range } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { UserError } from "@/lib/errors";
import { syncCaps } from "./caps";

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

// ---- Budget months as date ranges ----

export async function getPeriodStartDay(db: Db): Promise<number> {
  return (await getSettings(db)).periodStartDay;
}

/** Dates [from, to) of budget month `ym`: its row's range, or the one it would get. */
export async function rangeOf(db: Db, ym: string): Promise<Range> {
  const m = await getMonth(db, ym);
  if (m) return { from: m.startsOn, to: m.endsOn };
  const day = await getPeriodStartDay(db);
  return { from: periodStart(ym, day), to: periodEnd(ym, day) };
}

/** The budget month a date belongs to. */
export async function monthOfDate(db: Db, date: string): Promise<string> {
  const [m] = await db
    .select({ yearMonth: months.yearMonth })
    .from(months)
    .where(and(lte(months.startsOn, date), gt(months.endsOn, date)));
  return m?.yearMonth ?? periodOf(date, await getPeriodStartDay(db));
}

/** The budget month today falls in (e.g. on 30 Sep with cycles from the 25th: "2026-09"). */
export async function currentYm(db: Db): Promise<string> {
  return monthOfDate(db, today());
}

/**
 * Return the month row, creating it on first write. A new month's caps are the
 * totals of each category's monthly items (one-offs don't carry over); it copies
 * the alert % of the latest earlier month.
 */
export async function ensureMonth(db: Db, ym: string): Promise<Month> {
  const existing = await getMonth(db, ym);
  if (existing) return existing;

  return db.transaction(async (tx) => {
    const [prior] = await tx.select().from(months).where(lt(months.yearMonth, ym)).orderBy(desc(months.yearMonth)).limit(1);
    const [earliest] = prior ? [prior] : await tx.select().from(months).orderBy(asc(months.yearMonth)).limit(1);
    const source = prior ?? earliest ?? null;
    const s = await getSettings(tx);
    // Start where the previous month ends so months never overlap or leave gaps,
    // even after the start day is changed; otherwise use the start day.
    const [previous] = await tx.select().from(months).where(eq(months.yearMonth, addMonths(ym, -1)));
    const [following] = await tx.select().from(months).where(eq(months.yearMonth, addMonths(ym, 1)));
    const startsOn = previous?.endsOn ?? periodStart(ym, s.periodStartDay);
    const endsOn = following?.startsOn ?? periodEnd(ym, s.periodStartDay);

    const [month] = await tx
      .insert(months)
      .values({ yearMonth: ym, startsOn, endsOn, defaultAlertPct: source?.defaultAlertPct ?? s.defaultAlertPct })
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
          alertPct: byCat.get(c.id)?.alertPct ?? null,
        })),
      );
    }
    await syncCaps(tx);
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
  const range = await rangeOf(db, ym);
  const earlier = await db
    .select({ yearMonth: months.yearMonth })
    .from(months)
    .where(and(lt(months.yearMonth, ym), eq(months.status, "open")))
    .orderBy(asc(months.yearMonth));
  const [{ n }] = await db
    .select({ n: count() })
    .from(expenses)
    .where(and(isNull(expenses.categoryId), gte(expenses.spentOn, range.from), lt(expenses.spentOn, range.to)));
  const negative = month
    ? (await db.select().from(categoryMonthSummary).where(eq(categoryMonthSummary.monthId, month.id)))
        .filter((s) => s.remaining < 0)
        .map((s) => ({ name: s.name, remaining: s.remaining }))
    : [];
  return {
    notEnded: todayStr < addDays(range.to, -1),
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
    const lastDayOfMonth = addDays(month.endsOn, -1);
    if (b.notEnded) throw new UserError(`${formatMonth(ym)} can be closed from ${formatDay(lastDayOfMonth)}.`);
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
          occurredOn: lastDayOfMonth,
        })),
      );
    }
    // Income still expected (e.g. an unclaimed insurance payout) moves to next month.
    const pending = await tx
      .select({ id: incomes.id })
      .from(incomes)
      .where(and(eq(incomes.monthId, month.id), eq(incomes.status, "expected")));
    if (pending.length) {
      const next = await ensureMonth(tx, addMonths(ym, 1));
      await tx
        .update(incomes)
        .set({ monthId: next.id })
        .where(and(eq(incomes.monthId, month.id), eq(incomes.status, "expected")));
    }

    await tx.update(months).set({ status: "closed", closedAt: new Date() }).where(eq(months.id, month.id));
    return { swept: sweeps.reduce((a, s) => a + s.remaining, 0), movedIncome: pending.length };
  });
}
