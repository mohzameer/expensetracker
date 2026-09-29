import "server-only";
import { and, asc, desc, eq, gte, isNull, lt, lte, ne, or, sql, sum } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/db";
import { categories, categoryBudgets, categoryMonthSummary, expenses, incomes, items, monthlyItemStatus, months, transfers } from "@/db/schema";
import { addMonths, currentYearMonth, daysInMonth, firstDay, monthOf, nextMonthStart, today } from "@/lib/dates";
import { stateAfter } from "@/lib/budget";
import { closeBlockers, ensureMonth, getMonth, getSettings, type Month } from "@/server/domain/months";
import { getSavingsBalance } from "@/server/domain/transfers";

export type CategorySummary = {
  categoryId: string;
  name: string;
  color: string;
  allocation: number;
  effectiveAllocation: number;
  transfersIn: number;
  transfersOut: number;
  spent: number;
  remaining: number;
  swept: number;
  alertPct: number;
  archived: boolean;
};

export type CatalogCategory = { id: string; name: string; color: string };
export type CatalogItem = {
  id: string;
  categoryId: string;
  name: string;
  kind: "monthly" | "one_off";
  expectedAmount: number | null;
  defaultAmount: number | null;
};

export type DueItem = {
  itemId: string;
  categoryId: string;
  name: string;
  categoryName: string;
  expected: number;
  paid: number;
  status: "unpaid" | "partial" | "paid";
};

export type MonthInfo = { yearMonth: string; status: "open" | "closed"; defaultAlertPct: number } | null;

const monthInfo = (m: Month | null): MonthInfo =>
  m ? { yearMonth: m.yearMonth, status: m.status, defaultAlertPct: m.defaultAlertPct } : null;

/** Create the current month on first visit so allocations roll over by themselves. */
export async function touchCurrentMonth(db: Db) {
  await ensureMonth(db, currentYearMonth());
}

export async function getSummaries(db: Db, month: Month | null): Promise<CategorySummary[]> {
  if (!month) return [];
  const rows = await db
    .select()
    .from(categoryMonthSummary)
    .where(eq(categoryMonthSummary.monthId, month.id))
    .orderBy(asc(categoryMonthSummary.sortOrder), asc(categoryMonthSummary.name));
  return rows
    // Hide categories that have nothing to show this month: archived ones, or ones
    // with no cap (e.g. a one-off that only mattered last month) and no activity.
    .filter((r) => {
      const active = r.spent > 0 || r.transfersIn > 0 || r.transfersOut > 0 || r.swept > 0;
      return active || (!r.archivedAt && r.allocation > 0);
    })
    .map((r) => ({
      categoryId: r.categoryId,
      name: r.name,
      color: r.color,
      allocation: r.allocation,
      effectiveAllocation: r.effectiveAllocation,
      transfersIn: r.transfersIn,
      transfersOut: r.transfersOut,
      spent: r.spent,
      remaining: r.remaining,
      swept: r.swept,
      alertPct: r.alertPct,
      archived: !!r.archivedAt,
    }));
}

export async function getCatalog(db: Db) {
  const cats = await db
    .select({ id: categories.id, name: categories.name, color: categories.color })
    .from(categories)
    .where(isNull(categories.archivedAt))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
  const its = await db
    .select({
      id: items.id,
      categoryId: items.categoryId,
      name: items.name,
      kind: items.kind,
      expectedAmount: items.expectedAmount,
      defaultAmount: items.defaultAmount,
    })
    .from(items)
    .where(isNull(items.archivedAt))
    .orderBy(asc(items.sortOrder), asc(items.name));
  return { categories: cats as CatalogCategory[], items: its as CatalogItem[] };
}

export async function getMonthlyItems(db: Db, month: Month | null): Promise<DueItem[]> {
  if (!month) return [];
  const rows = await db
    .select({
      itemId: monthlyItemStatus.itemId,
      categoryId: monthlyItemStatus.categoryId,
      name: monthlyItemStatus.name,
      categoryName: categories.name,
      expected: monthlyItemStatus.expected,
      paid: monthlyItemStatus.paid,
      status: monthlyItemStatus.status,
    })
    .from(monthlyItemStatus)
    .innerJoin(categories, eq(categories.id, monthlyItemStatus.categoryId))
    .where(eq(monthlyItemStatus.monthId, month.id))
    .orderBy(asc(categories.sortOrder), asc(monthlyItemStatus.name));
  return rows;
}

async function inboxCount(db: Db) {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(expenses).where(isNull(expenses.categoryId));
  return Number(row?.n ?? 0);
}

const expenseColumns = {
  id: expenses.id,
  spentOn: expenses.spentOn,
  amount: expenses.amount,
  note: expenses.note,
  categoryId: expenses.categoryId,
  categoryName: categories.name,
  color: categories.color,
  itemId: expenses.itemId,
  itemName: items.name,
  itemKind: items.kind,
};

export type ExpenseRow = {
  id: string;
  spentOn: string;
  amount: number;
  note: string | null;
  categoryId: string | null;
  categoryName: string | null;
  color: string | null;
  itemId: string | null;
  itemName: string | null;
  itemKind: "monthly" | "one_off" | null;
};

export async function getDayView(db: Db, date: string) {
  const ym = monthOf(date);
  const month = await getMonth(db, ym);
  const [settings, summaries, catalog, monthly, dayExpenses, count, savings, monthSpend] = await Promise.all([
    getSettings(db),
    getSummaries(db, month),
    getCatalog(db),
    getMonthlyItems(db, month),
    db
      .select(expenseColumns)
      .from(expenses)
      .leftJoin(categories, eq(categories.id, expenses.categoryId))
      .leftJoin(items, eq(items.id, expenses.itemId))
      .where(eq(expenses.spentOn, date))
      .orderBy(asc(expenses.createdAt)),
    inboxCount(db),
    getSavingsBalance(db),
    db
      .select({ total: sum(expenses.amount).mapWith(Number) })
      .from(expenses)
      .where(and(gte(expenses.spentOn, firstDay(ym)), lt(expenses.spentOn, nextMonthStart(ym)))),
  ]);

  const allocated = summaries.reduce((a, s) => a + s.effectiveAllocation, 0);
  const left = summaries.reduce((a, s) => a + s.remaining, 0);
  return {
    date,
    today: today(),
    ym,
    month: monthInfo(month),
    currency: settings.currencySymbol,
    defaultAlertPct: month?.defaultAlertPct ?? settings.defaultAlertPct,
    summaries,
    catalog,
    monthly,
    expenses: dayExpenses as ExpenseRow[],
    inboxCount: count,
    savings,
    totals: {
      spentToday: dayExpenses.reduce((a, e) => a + e.amount, 0),
      spentMonth: monthSpend[0]?.total ?? 0,
      allocated,
      left,
    },
  };
}

export type DayView = Awaited<ReturnType<typeof getDayView>>;

export async function getInbox(db: Db) {
  const rows = (await db
    .select(expenseColumns)
    .from(expenses)
    .leftJoin(categories, eq(categories.id, expenses.categoryId))
    .leftJoin(items, eq(items.id, expenses.itemId))
    .where(isNull(expenses.categoryId))
    .orderBy(desc(expenses.spentOn), desc(expenses.createdAt))) as ExpenseRow[];
  const yms = [...new Set(rows.map((r) => monthOf(r.spentOn)))];
  const summariesByMonth: Record<string, CategorySummary[]> = {};
  for (const ym of yms) summariesByMonth[ym] = await getSummaries(db, await getMonth(db, ym));
  const settings = await getSettings(db);
  return { rows, summariesByMonth, catalog: await getCatalog(db), currency: settings.currencySymbol };
}

export type IncomeLine = { id: string; source: string; amount: number; status: "expected" | "received"; receivedOn: string | null };

export async function getIncomes(db: Db, month: Month | null): Promise<IncomeLine[]> {
  if (!month) return [];
  return db
    .select({ id: incomes.id, source: incomes.source, amount: incomes.amount, status: incomes.status, receivedOn: incomes.receivedOn })
    .from(incomes)
    .where(eq(incomes.monthId, month.id))
    .orderBy(asc(incomes.sortOrder), asc(incomes.createdAt));
}

export type MonthPlan =
  | { kind: "plan"; carriedIn: number; received: number; expected: number; budgets: number; freeAfter: number }
  | { kind: "actual"; received: number; spent: number; returned: number };

/**
 * Your sheet's view of a month: money carried in + income − budgets = free after
 * the month (assuming budgets are fully spent). Past months report actuals instead.
 */
export async function getMonthPlan(db: Db, ym: string): Promise<MonthPlan> {
  const cur = currentYearMonth();
  const incomeRows = await db
    .select({ yearMonth: months.yearMonth, status: incomes.status, amount: incomes.amount })
    .from(incomes)
    .innerJoin(months, eq(months.id, incomes.monthId))
    .where(lte(months.yearMonth, ym));
  const received = incomeRows.filter((r) => r.yearMonth === ym && r.status === "received").reduce((a, r) => a + r.amount, 0);

  if (ym < cur) {
    const month = await getMonth(db, ym);
    const summaries = await getSummaries(db, month);
    return {
      kind: "actual",
      received,
      spent: summaries.reduce((a, x) => a + x.spent, 0),
      returned: summaries.reduce((a, x) => a + x.swept, 0),
    };
  }

  const budgetRows = await db
    .select({ yearMonth: months.yearMonth, total: sql<number>`coalesce(sum(${categoryBudgets.allocation}), 0)::bigint`.mapWith(Number) })
    .from(categoryBudgets)
    .innerJoin(months, eq(months.id, categoryBudgets.monthId))
    .where(and(gte(months.yearMonth, cur), lte(months.yearMonth, ym)))
    .groupBy(months.yearMonth);
  const budgetOf = (m: string) => budgetRows.find((b) => b.yearMonth === m)?.total ?? 0;

  const savingsNow = await getSavingsBalance(db, cur); // already net of this month's budgets
  const expectedToDate = incomeRows.filter((r) => r.status === "expected").reduce((a, r) => a + r.amount, 0);
  const futureBudgets = budgetRows.filter((b) => b.yearMonth > cur).reduce((a, b) => a + b.total, 0);
  const freeAfter = savingsNow + expectedToDate - futureBudgets;
  const expected = incomeRows.filter((r) => r.yearMonth === ym && r.status === "expected").reduce((a, r) => a + r.amount, 0);
  const budgets = budgetOf(ym);
  return { kind: "plan", carriedIn: freeAfter - received - expected + budgets, received, expected, budgets, freeAfter };
}

export async function getDashboard(db: Db, ym: string) {
  const month = await getMonth(db, ym);
  const [income, plan, settings, summaries, monthly, daily] = await Promise.all([
    getIncomes(db, month),
    getMonthPlan(db, ym),
    getSettings(db),
    getSummaries(db, month),
    getMonthlyItems(db, month),
    db
      .select({ day: expenses.spentOn, total: sum(expenses.amount).mapWith(Number) })
      .from(expenses)
      .where(and(gte(expenses.spentOn, firstDay(ym)), lt(expenses.spentOn, nextMonthStart(ym))))
      .groupBy(expenses.spentOn),
  ]);

  const days = daysInMonth(ym);
  const weeks = [0, 1, 2, 3, 4]
    .map((w) => {
      const from = w * 7 + 1;
      const to = Math.min(from + 6, days);
      return from > days ? null : { label: `${from}–${to}`, from, to, total: 0 };
    })
    .filter((w): w is NonNullable<typeof w> => !!w);
  let uncategorized = 0;
  for (const d of daily) {
    const n = Number(d.day.slice(8, 10));
    const w = weeks.find((x) => n >= x.from && n <= x.to);
    if (w) w.total += d.total;
  }
  const categorisedSpent = summaries.reduce((a, s) => a + s.spent, 0);
  const totalSpent = daily.reduce((a, d) => a + d.total, 0);
  uncategorized = totalSpent - categorisedSpent;

  const allocated = summaries.reduce((a, s) => a + s.effectiveAllocation, 0);
  const owed = monthly.filter((m) => m.status !== "paid");
  return {
    ym,
    month: monthInfo(month),
    currency: settings.currencySymbol,
    summaries: summaries.map((s) => ({ ...s, state: stateAfter(s, 0).state })),
    totals: {
      allocated,
      spent: totalSpent,
      left: summaries.reduce((a, s) => a + s.remaining, 0),
      owed: owed.reduce((a, m) => a + Math.max(m.expected - m.paid, 0), 0),
      uncategorized,
    },
    owed,
    income,
    plan,
    weeks: weeks.map((w) => ({ label: w.label, total: w.total, days: w.to - w.from + 1 })),
    evenPacePerDay: days ? allocated / days : 0,
  };
}

export async function getSavingsPage(db: Db) {
  const fromCat = alias(categories, "from_cat");
  const toCat = alias(categories, "to_cat");
  const cur = currentYearMonth();
  const [settings, balance, ledger, perMonth, catalog, setAside, expected] = await Promise.all([
    getSettings(db),
    getSavingsBalance(db, cur),
    db
      .select({
        id: transfers.id,
        occurredOn: transfers.occurredOn,
        reason: transfers.reason,
        note: transfers.note,
        amount: transfers.amount,
        fromKind: transfers.fromKind,
        toKind: transfers.toKind,
        fromName: fromCat.name,
        toName: toCat.name,
        yearMonth: months.yearMonth,
      })
      .from(transfers)
      .innerJoin(months, eq(months.id, transfers.monthId))
      .leftJoin(fromCat, eq(fromCat.id, transfers.fromCategoryId))
      .leftJoin(toCat, eq(toCat.id, transfers.toCategoryId))
      .where(or(eq(transfers.fromKind, "savings"), eq(transfers.toKind, "savings")))
      .orderBy(desc(transfers.occurredOn), desc(transfers.createdAt))
      .limit(300),
    db
      .select({
        yearMonth: months.yearMonth,
        status: months.status,
        // Income + leftovers returned − the month's budgets − covers taken from Savings.
        // For a closed month that is simply income − spending. Manual adjustments don't count.
        net: sql<number>`(coalesce(sum(case when ${transfers.toKind} = 'savings' then ${transfers.amount} when ${transfers.fromKind} = 'savings' then -${transfers.amount} else 0 end), 0)
          - (select coalesce(sum(b.allocation), 0) from category_budgets b where b.month_id = ${months.id}))::bigint`.mapWith(Number),
        income: sql<number>`coalesce(sum(${transfers.amount}) filter (where ${transfers.reason} = 'income'), 0)::bigint`.mapWith(Number),
        sweptIn: sql<number>`coalesce(sum(${transfers.amount}) filter (where ${transfers.reason} = 'month_close'), 0)::bigint`.mapWith(Number),
      })
      .from(months)
      .leftJoin(
        transfers,
        and(
          eq(transfers.monthId, months.id),
          or(eq(transfers.reason, "income"), and(ne(transfers.fromKind, "external"), ne(transfers.toKind, "external"))),
        ),
      )
      .where(and(gte(months.yearMonth, addMonths(cur, -11)), lte(months.yearMonth, cur)))
      .groupBy(months.id, months.yearMonth, months.status)
      .orderBy(asc(months.yearMonth)),
    getCatalog(db),
    // This month's budgets, already taken out of the free balance.
    db
      .select({ total: sql<number>`coalesce(sum(${categoryBudgets.allocation}), 0)::bigint`.mapWith(Number) })
      .from(categoryBudgets)
      .innerJoin(months, eq(months.id, categoryBudgets.monthId))
      .where(and(eq(months.yearMonth, cur), eq(months.status, "open"))),
    db
      .select({ source: incomes.source, amount: incomes.amount, yearMonth: months.yearMonth })
      .from(incomes)
      .innerJoin(months, eq(months.id, incomes.monthId))
      .where(and(eq(incomes.status, "expected"), lte(months.yearMonth, addMonths(cur, 1))))
      .orderBy(asc(months.yearMonth)),
  ]);
  return {
    currency: settings.currencySymbol,
    balance,
    setAside: setAside[0]?.total ?? 0,
    expected,
    ledger: ledger.map((l) => ({ ...l, signed: l.toKind === "savings" ? l.amount : -l.amount })),
    perMonth,
    categories: catalog.categories,
    ym: currentYearMonth(),
  };
}

export async function getClosePage(db: Db, ym: string) {
  const month = await getMonth(db, ym);
  const t = today();
  const [income, settings, summaries, monthly, blockers, uncategorized, savings, catalog] = await Promise.all([
    getIncomes(db, month),
    getSettings(db),
    getSummaries(db, month),
    getMonthlyItems(db, month),
    closeBlockers(db, ym, t),
    db
      .select(expenseColumns)
      .from(expenses)
      .leftJoin(categories, eq(categories.id, expenses.categoryId))
      .leftJoin(items, eq(items.id, expenses.itemId))
      .where(and(isNull(expenses.categoryId), gte(expenses.spentOn, firstDay(ym)), lt(expenses.spentOn, nextMonthStart(ym))))
      .orderBy(asc(expenses.spentOn)),
    getSavingsBalance(db),
    getCatalog(db),
  ]);
  return {
    ym,
    today: t,
    month: monthInfo(month),
    closedAt: month?.closedAt?.toISOString() ?? null,
    currency: settings.currencySymbol,
    summaries,
    monthly,
    blockers,
    uncategorized: uncategorized as ExpenseRow[],
    savings,
    pendingIncome: income.filter((i) => i.status === "expected"),
    categories: catalog.categories,
  };
}

/** Earliest open month that has ended or is the current one: what "Close month" should open. */
export async function nextMonthToClose(db: Db) {
  const cur = currentYearMonth();
  const [row] = await db
    .select({ yearMonth: months.yearMonth })
    .from(months)
    .where(and(eq(months.status, "open"), lt(months.yearMonth, cur)))
    .orderBy(asc(months.yearMonth))
    .limit(1);
  return row?.yearMonth ?? cur;
}

export async function getSetupPage(db: Db, ym: string) {
  const cur = currentYearMonth();
  const month = ym >= cur ? await ensureMonth(db, ym) : await getMonth(db, ym);
  const prevYm = addMonths(ym, -1);
  const prev = await getMonth(db, prevYm);
  const [income, plan, settings, catalog, budgets, prevBudgets] = await Promise.all([
    getIncomes(db, month),
    getMonthPlan(db, ym),
    getSettings(db),
    getCatalog(db),
    month ? db.select().from(categoryBudgets).where(eq(categoryBudgets.monthId, month.id)) : [],
    prev ? db.select().from(categoryBudgets).where(eq(categoryBudgets.monthId, prev.id)) : [],
  ]);
  const byCat = new Map(budgets.map((b) => [b.categoryId, b]));
  return {
    ym,
    prevYm,
    month: monthInfo(month),
    currencySymbol: settings.currencySymbol,
    currencyCode: settings.currencyCode,
    defaultAlertPct: month?.defaultAlertPct ?? settings.defaultAlertPct,
    incomes: income,
    plan,
    defaultIncome: { source: settings.defaultIncomeSource, amount: settings.defaultIncomeAmount },
    prevAllocations: Object.fromEntries(prevBudgets.map((b) => [b.categoryId, b.allocation])) as Record<string, number>,
    categories: catalog.categories.map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      allocation: byCat.get(c.id)?.allocation ?? 0,
      alertPct: byCat.get(c.id)?.alertPct ?? null,
      items: catalog.items
        .filter((i) => i.categoryId === c.id)
        .map((i) => ({ id: i.id, name: i.name, kind: i.kind, expectedAmount: i.expectedAmount, defaultAmount: i.defaultAmount })),
    })),
  };
}

export async function getExportRows(db: Db, ym: string | null) {
  const where = ym ? and(gte(expenses.spentOn, firstDay(ym)), lt(expenses.spentOn, nextMonthStart(ym))) : undefined;
  return (await db
    .select(expenseColumns)
    .from(expenses)
    .leftJoin(categories, eq(categories.id, expenses.categoryId))
    .leftJoin(items, eq(items.id, expenses.itemId))
    .where(where)
    .orderBy(asc(expenses.spentOn), asc(expenses.createdAt))) as ExpenseRow[];
}

