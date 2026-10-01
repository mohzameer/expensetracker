import "server-only";
import { and, asc, desc, eq, gt, gte, isNotNull, isNull, lt, lte, sql, sum } from "drizzle-orm";
import type { Db } from "@/db";
import { accountEntries, accounts, categories, categoryBudgets, categoryMonthSummary, expenses, incomes, items, monthlyItemStatus, months } from "@/db/schema";
import { getAccounts, totalBalance } from "@/server/domain/accounts";
import { addDays, addMonths, diffDays, formatDay, formatRange, periodOf, periodStart, today, type Range } from "@/lib/dates";
import { stateAfter } from "@/lib/budget";
import { closeBlockers, currentYm, ensureMonth, getMonth, getSettings, monthOfDate, rangeOf, type Month } from "@/server/domain/months";
import { itemsForMonth } from "@/server/domain/catalog";
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
  await ensureMonth(db, await currentYm(db));
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

/** Categories plus the items offered in a month (monthly items + that month's one-offs). */
export async function getCatalog(db: Db, month: Month | null = null) {
  const cats = await db
    .select({ id: categories.id, name: categories.name, color: categories.color })
    .from(categories)
    .where(isNull(categories.archivedAt))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
  const its = await itemsForMonth(db, month?.id ?? null);
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
  accountId: expenses.accountId,
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
  accountId: string | null;
};

export async function getDayView(db: Db, date: string) {
  const ym = await monthOfDate(db, date);
  const month = await getMonth(db, ym);
  const range = await rangeOf(db, ym);
  const [accountList, settings, summaries, catalog, monthly, dayExpenses, count, savings, monthSpend] = await Promise.all([
    getAccounts(db),
    getSettings(db),
    getSummaries(db, month),
    getCatalog(db, month),
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
      .where(and(gte(expenses.spentOn, range.from), lt(expenses.spentOn, range.to))),
  ]);

  const allocated = summaries.reduce((a, s) => a + s.effectiveAllocation, 0);
  const left = summaries.reduce((a, s) => a + s.remaining, 0);
  return {
    date,
    today: today(),
    ym,
    range, // the budget month's dates, e.g. 25 Sep → 25 Oct (exclusive)
    startDay: settings.periodStartDay,
    month: monthInfo(month),
    currency: settings.currencySymbol,
    defaultAlertPct: month?.defaultAlertPct ?? settings.defaultAlertPct,
    summaries,
    catalog,
    monthly,
    expenses: dayExpenses as ExpenseRow[],
    inboxCount: count,
    savings,
    accounts: accountList,
    defaultAccountId: settings.defaultAccountId,
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
  // Which budget month each expense belongs to, and that month's balances.
  const monthByRow: Record<string, string> = {};
  for (const r of rows) monthByRow[r.id] = await monthOfDate(db, r.spentOn);
  const summariesByMonth: Record<string, CategorySummary[]> = {};
  for (const ym of new Set(Object.values(monthByRow))) summariesByMonth[ym] = await getSummaries(db, await getMonth(db, ym));
  const settings = await getSettings(db);
  return { rows, monthByRow, summariesByMonth, catalog: await getCatalog(db), currency: settings.currencySymbol };
}

export type IncomeLine = {
  id: string;
  source: string;
  amount: number;
  status: "expected" | "received";
  receivedOn: string | null;
  accountId: string | null;
  accountName: string | null;
};

export async function getIncomes(db: Db, month: Month | null): Promise<IncomeLine[]> {
  if (!month) return [];
  return db
    .select({
      id: incomes.id,
      source: incomes.source,
      amount: incomes.amount,
      status: incomes.status,
      receivedOn: incomes.receivedOn,
      accountId: incomes.accountId,
      accountName: accounts.name,
    })
    .from(incomes)
    .leftJoin(accounts, eq(accounts.id, incomes.accountId))
    .where(eq(incomes.monthId, month.id))
    .orderBy(asc(incomes.sortOrder), asc(incomes.createdAt));
}

export type MonthPlan =
  | { kind: "current"; inAccounts: number; leftToSpend: number; freeAfter: number }
  | { kind: "future"; carriedIn: number; budgets: number; freeAfter: number }
  | { kind: "actual"; spent: number; returned: number };

/** Unspent budget (never below 0) per category, for open months up to `ym`. */
async function committedByMonth(db: Db, ym: string) {
  return db
    .select({
      yearMonth: categoryMonthSummary.yearMonth,
      categoryId: categoryMonthSummary.categoryId,
      remaining: categoryMonthSummary.remaining,
      delta: sql<number>`(${categoryMonthSummary.transfersIn} - ${categoryMonthSummary.transfersOut} - ${categoryMonthSummary.spent})::bigint`.mapWith(Number),
    })
    .from(categoryMonthSummary)
    .innerJoin(months, eq(months.id, categoryMonthSummary.monthId))
    .where(and(eq(months.status, "open"), lte(months.yearMonth, ym)));
}

/**
 * A month in cash terms. This month: money in your accounts − what's still unspent
 * in budgets = free after the month. A later month: carried in − its budgets.
 * Past months report actuals. (Expected income is left out for now.)
 */
export async function getMonthPlan(db: Db, ym: string): Promise<MonthPlan> {
  const cur = await currentYm(db);
  if (ym < cur) {
    const summaries = await getSummaries(db, await getMonth(db, ym));
    return {
      kind: "actual",
      spent: summaries.reduce((a, x) => a + x.spent, 0),
      returned: summaries.reduce((a, x) => a + x.swept, 0),
    };
  }

  const inAccounts = await totalBalance(db);
  const leftToSpend = (await committedByMonth(db, cur)).reduce((a, r) => a + Math.max(r.remaining, 0), 0);
  const freeNow = inAccounts - leftToSpend;
  if (ym === cur) return { kind: "current", inAccounts, leftToSpend, freeAfter: freeNow };

  const budgetRows = await db
    .select({ yearMonth: months.yearMonth, total: sql<number>`coalesce(sum(${categoryBudgets.allocation}), 0)::bigint`.mapWith(Number) })
    .from(categoryBudgets)
    .innerJoin(months, eq(months.id, categoryBudgets.monthId))
    .where(and(gt(months.yearMonth, cur), lte(months.yearMonth, ym)))
    .groupBy(months.yearMonth);
  const budgets = budgetRows.find((b) => b.yearMonth === ym)?.total ?? 0;
  const freeAfter = freeNow - budgetRows.reduce((a, b) => a + b.total, 0);
  return { kind: "future", carriedIn: freeAfter + budgets, budgets, freeAfter };
}

/**
 * Pieces Setup needs to recompute "free after the month" live while caps are
 * edited: free = base − (unspent budgets of the categories in the form).
 */
export async function getSetupPlanBase(db: Db, ym: string, plan: MonthPlan, categoryIds: string[]) {
  const cur = await currentYm(db);
  if (plan.kind === "current") {
    const rows = await committedByMonth(db, cur);
    const inForm = new Set(categoryIds);
    const others = rows.filter((r) => r.yearMonth !== ym || !inForm.has(r.categoryId)).reduce((a, r) => a + Math.max(r.remaining, 0), 0);
    const deltas = Object.fromEntries(rows.filter((r) => r.yearMonth === ym).map((r) => [r.categoryId, r.delta]));
    return { kind: "current" as const, base: plan.inAccounts - others, deltas };
  }
  if (plan.kind === "future") {
    return { kind: "future" as const, base: plan.carriedIn, deltas: {} as Record<string, number> };
  }
  return null;
}

export async function getDashboard(db: Db, ym: string) {
  const month = await getMonth(db, ym);
  const range = await rangeOf(db, ym);
  const [accountList, plan, settings, summaries, monthly, daily] = await Promise.all([
    getAccounts(db),
    getMonthPlan(db, ym),
    getSettings(db),
    getSummaries(db, month),
    getMonthlyItems(db, month),
    db
      .select({ day: expenses.spentOn, categoryId: expenses.categoryId, total: sum(expenses.amount).mapWith(Number) })
      .from(expenses)
      .where(and(gte(expenses.spentOn, range.from), lt(expenses.spentOn, range.to)))
      .groupBy(expenses.spentOn, expenses.categoryId),
  ]);
  // The weekly chart leaves out the categories hidden with its filter.
  const hidden = new Set(settings.chartHiddenCategoryIds);

  // 7-day blocks from the month's first day (e.g. 25 Sep, 2 Oct, … 23 Oct).
  const days = diffDays(range.to, range.from);
  const weeks: { label: string; detail: string; from: string; to: string; total: number }[] = [];
  for (let start = range.from; start < range.to; start = addDays(start, 7)) {
    const end = addDays(start, 7) < range.to ? addDays(start, 7) : range.to; // exclusive
    weeks.push({
      label: formatDay(start, { day: "numeric", month: "short" }),
      detail: formatRange(start, end),
      from: start,
      to: end,
      total: 0,
    });
  }
  let uncategorized = 0;
  for (const d of daily) {
    if (d.categoryId && hidden.has(d.categoryId)) continue;
    const w = weeks.find((x) => d.day >= x.from && d.day < x.to);
    if (w) w.total += d.total;
  }
  const categorisedSpent = summaries.reduce((a, s) => a + s.spent, 0);
  const totalSpent = daily.reduce((a, d) => a + d.total, 0);
  uncategorized = totalSpent - categorisedSpent;

  const allocated = summaries.reduce((a, s) => a + s.effectiveAllocation, 0);
  const owed = monthly.filter((m) => m.status !== "paid");
  return {
    ym,
    range,
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
    accounts: accountList,
    plan,
    weeks: weeks.map((w) => ({ label: w.label, detail: w.detail, total: w.total, days: diffDays(w.to, w.from) })),
    // Even pace for the categories still shown.
    evenPacePerDay: days ? summaries.filter((s) => !hidden.has(s.categoryId)).reduce((a, s) => a + s.effectiveAllocation, 0) / days : 0,
    chartFilter: {
      hidden: settings.chartHiddenCategoryIds,
      categories: summaries.map((s) => ({ id: s.categoryId, name: s.name, color: s.color })),
    },
  };
}

/** Accounts page: balances, free money, and every movement in or out of an account. */
export async function getMoneyPage(db: Db) {
  const cur = await currentYm(db);
  const [settings, accountList, free, committed, entries, incomeIn, spendDays, catalog] = await Promise.all([
    getSettings(db),
    getAccounts(db),
    getSavingsBalance(db, cur),
    committedByMonth(db, cur),
    db
      .select({ id: accountEntries.id, accountId: accountEntries.accountId, date: accountEntries.occurredOn, amount: accountEntries.amount, kind: accountEntries.kind, note: accountEntries.note })
      .from(accountEntries)
      .orderBy(desc(accountEntries.occurredOn), desc(accountEntries.createdAt))
      .limit(300),
    db
      .select({ id: incomes.id, accountId: incomes.accountId, date: incomes.receivedOn, amount: incomes.amount, source: incomes.source })
      .from(incomes)
      .where(and(eq(incomes.status, "received"), isNotNull(incomes.accountId)))
      .limit(300),
    db
      .select({ accountId: expenses.accountId, date: expenses.spentOn, total: sum(expenses.amount).mapWith(Number), n: sql<number>`count(*)::int`.mapWith(Number) })
      .from(expenses)
      .where(and(isNotNull(expenses.accountId), gte(expenses.spentOn, (await rangeOf(db, addMonths(cur, -2))).from)))
      .groupBy(expenses.accountId, expenses.spentOn),
    getCatalog(db),
  ]);

  const KIND = { opening: "Opening balance", adjustment: "Adjustment", transfer: "Transfer" } as const;
  const ledger = [
    ...entries.map((e) => ({
      key: e.id,
      accountId: e.accountId,
      date: e.date,
      what: e.note ?? KIND[e.kind],
      type: KIND[e.kind],
      amount: e.amount,
      adjustmentId: e.kind === "adjustment" ? (e.id as string | null) : null, // removable from the Adjustments list
    })),
    ...incomeIn.map((i) => ({ key: i.id, accountId: i.accountId!, date: i.date!, what: i.source, type: "Income", amount: i.amount, adjustmentId: null })),
    ...spendDays.map((d) => ({
      key: `x-${d.accountId}-${d.date}`,
      accountId: d.accountId!,
      date: d.date,
      what: `${d.n} expense${d.n === 1 ? "" : "s"}`,
      type: "Spending",
      amount: -d.total,
      adjustmentId: null,
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return {
    currency: settings.currencySymbol,
    ym: cur,
    accounts: accountList,
    defaultAccountId: settings.defaultAccountId,
    free,
    leftToSpend: committed.reduce((a, r) => a + Math.max(r.remaining, 0), 0),
    ledger,
    categories: catalog.categories,
  };
}

/** Spending by day, week (Mon–Sun) and budget month, with a category split for each bucket. */
export async function getSpending(db: Db) {
  const t = today();
  const settings = await getSettings(db);
  const from = periodStart(addMonths(periodOf(t, settings.periodStartDay), -11), settings.periodStartDay);
  const [rows] = await Promise.all([
    db
      .select({
        date: expenses.spentOn,
        categoryId: expenses.categoryId,
        name: categories.name,
        color: categories.color,
        total: sum(expenses.amount).mapWith(Number),
      })
      .from(expenses)
      .leftJoin(categories, eq(categories.id, expenses.categoryId))
      .where(and(gte(expenses.spentOn, from), lte(expenses.spentOn, t)))
      .groupBy(expenses.spentOn, expenses.categoryId, categories.name, categories.color),
  ]);
  const catalog = await getCatalog(db);
  return {
    today: t,
    startDay: settings.periodStartDay,
    hidden: settings.chartHiddenCategoryIds,
    // Every category that appears in the chart period or is in use now, for the filter.
    filterCategories: [
      ...new Map(
        [...catalog.categories, ...rows.filter((r) => r.categoryId).map((r) => ({ id: r.categoryId!, name: r.name!, color: r.color! }))].map(
          (c) => [c.id, c],
        ),
      ).values(),
    ],
    currency: settings.currencySymbol,
    rows: rows.map((r) => ({ ...r, name: r.name ?? "Needs category", color: r.color ?? "var(--faint)" })),
  };
}

export async function getClosePage(db: Db, ym: string) {
  const month = await getMonth(db, ym);
  const range = await rangeOf(db, ym);
  const t = today();
  const [settings, summaries, monthly, blockers, uncategorized, savings, catalog] = await Promise.all([
    getSettings(db),
    getSummaries(db, month),
    getMonthlyItems(db, month),
    closeBlockers(db, ym, t),
    db
      .select(expenseColumns)
      .from(expenses)
      .leftJoin(categories, eq(categories.id, expenses.categoryId))
      .leftJoin(items, eq(items.id, expenses.itemId))
      .where(and(isNull(expenses.categoryId), gte(expenses.spentOn, range.from), lt(expenses.spentOn, range.to)))
      .orderBy(asc(expenses.spentOn)),
    getSavingsBalance(db),
    getCatalog(db),
  ]);
  return {
    ym,
    range,
    today: t,
    month: monthInfo(month),
    closedAt: month?.closedAt?.toISOString() ?? null,
    currency: settings.currencySymbol,
    summaries,
    monthly,
    blockers,
    uncategorized: uncategorized as ExpenseRow[],
    savings,
    categories: catalog.categories,
  };
}

/** Earliest open month that has ended or is the current one: what "Close month" should open. */
export async function nextMonthToClose(db: Db) {
  const cur = await currentYm(db);
  const [row] = await db
    .select({ yearMonth: months.yearMonth })
    .from(months)
    .where(and(eq(months.status, "open"), lt(months.yearMonth, cur)))
    .orderBy(asc(months.yearMonth))
    .limit(1);
  return row?.yearMonth ?? cur;
}

export async function getSetupPage(db: Db, ym: string) {
  const cur = await currentYm(db);
  const month = ym >= cur ? await ensureMonth(db, ym) : await getMonth(db, ym);
  const prevYm = addMonths(ym, -1);
  const prev = await getMonth(db, prevYm);
  const [plan, settings, catalog, budgets, prevBudgets, accountList] = await Promise.all([
    getMonthPlan(db, ym),
    getSettings(db),
    getCatalog(db, month),
    month ? db.select().from(categoryBudgets).where(eq(categoryBudgets.monthId, month.id)) : [],
    prev ? db.select().from(categoryBudgets).where(eq(categoryBudgets.monthId, prev.id)) : [],
    getAccounts(db),
  ]);
  const byCat = new Map(budgets.map((b) => [b.categoryId, b]));
  const planBase = await getSetupPlanBase(db, ym, plan, catalog.categories.map((c) => c.id));
  return {
    ym,
    range: await rangeOf(db, ym),
    periodStartDay: settings.periodStartDay,
    prevYm,
    month: monthInfo(month),
    currencySymbol: settings.currencySymbol,
    currencyCode: settings.currencyCode,
    defaultAlertPct: month?.defaultAlertPct ?? settings.defaultAlertPct,
    plan,
    planBase,
    accounts: accountList,
    defaultAccountId: settings.defaultAccountId,
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
  const range: Range | null = ym ? await rangeOf(db, ym) : null;
  const where = range ? and(gte(expenses.spentOn, range.from), lt(expenses.spentOn, range.to)) : undefined;
  return (await db
    .select(expenseColumns)
    .from(expenses)
    .leftJoin(categories, eq(categories.id, expenses.categoryId))
    .leftJoin(items, eq(items.id, expenses.itemId))
    .where(where)
    .orderBy(asc(expenses.spentOn), asc(expenses.createdAt))) as ExpenseRow[];
}

