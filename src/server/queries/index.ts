import "server-only";
import { and, asc, desc, eq, gt, gte, isNotNull, isNull, lt, lte, sql, sum } from "drizzle-orm";
import type { Db } from "@/db";
import { accountEntries, accounts, categories, categoryBudgets, categoryMonthSummary, expenses, incomes, items, monthlyItemStatus, months } from "@/db/schema";
import { getAccounts, totalBalance } from "@/server/domain/accounts";
import { addMonths, currentYearMonth, daysInMonth, firstDay, monthOf, nextMonthStart, today } from "@/lib/dates";
import { stateAfter } from "@/lib/budget";
import { closeBlockers, ensureMonth, getMonth, getSettings, type Month } from "@/server/domain/months";
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
  const ym = monthOf(date);
  const month = await getMonth(db, ym);
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
  const yms = [...new Set(rows.map((r) => monthOf(r.spentOn)))];
  const summariesByMonth: Record<string, CategorySummary[]> = {};
  for (const ym of yms) summariesByMonth[ym] = await getSummaries(db, await getMonth(db, ym));
  const settings = await getSettings(db);
  return { rows, summariesByMonth, catalog: await getCatalog(db), currency: settings.currencySymbol };
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
  | { kind: "current"; inAccounts: number; expected: number; leftToSpend: number; freeAfter: number }
  | { kind: "future"; carriedIn: number; income: number; budgets: number; freeAfter: number }
  | { kind: "actual"; received: number; spent: number; returned: number };

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
 * Your sheet's view of a month, in cash terms. This month: money in your accounts
 * + income still expected − what's left to spend in budgets = free after the month.
 * A later month: carried in + its income − its budgets. Past months report actuals.
 */
export async function getMonthPlan(db: Db, ym: string): Promise<MonthPlan> {
  const cur = currentYearMonth();
  const incomeRows = await db
    .select({ yearMonth: months.yearMonth, status: incomes.status, amount: incomes.amount })
    .from(incomes)
    .innerJoin(months, eq(months.id, incomes.monthId))
    .where(lte(months.yearMonth, ym < cur ? ym : ym));
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

  const inAccounts = await totalBalance(db);
  const leftToSpend = (await committedByMonth(db, cur)).reduce((a, r) => a + Math.max(r.remaining, 0), 0);
  const expectedUpTo = (m: string) =>
    incomeRows.filter((r) => r.status === "expected" && r.yearMonth <= m).reduce((a, r) => a + r.amount, 0);
  const freeAfterCur = inAccounts + expectedUpTo(cur) - leftToSpend;
  if (ym === cur) return { kind: "current", inAccounts, expected: expectedUpTo(cur), leftToSpend, freeAfter: freeAfterCur };

  const budgetRows = await db
    .select({ yearMonth: months.yearMonth, total: sql<number>`coalesce(sum(${categoryBudgets.allocation}), 0)::bigint`.mapWith(Number) })
    .from(categoryBudgets)
    .innerJoin(months, eq(months.id, categoryBudgets.monthId))
    .where(and(gt(months.yearMonth, cur), lte(months.yearMonth, ym)))
    .groupBy(months.yearMonth);
  const futureBudgets = budgetRows.reduce((a, b) => a + b.total, 0);
  const budgets = budgetRows.find((b) => b.yearMonth === ym)?.total ?? 0;
  const freeAfter = freeAfterCur + (expectedUpTo(ym) - expectedUpTo(cur)) - futureBudgets;
  const expected = incomeRows.filter((r) => r.yearMonth === ym && r.status === "expected").reduce((a, r) => a + r.amount, 0);
  const income = expected + received;
  // Income received early for this month is already in the accounts, so it isn't carried in twice.
  return { kind: "future", carriedIn: freeAfter - income + budgets, income, budgets, freeAfter };
}

/**
 * Pieces Setup needs to recompute "free after the month" live while caps and
 * income lines are edited: free = base + expected lines − (unspent budgets of the form).
 */
export async function getSetupPlanBase(db: Db, ym: string, plan: MonthPlan, thisMonthExpected: number, categoryIds: string[]) {
  const cur = currentYearMonth();
  if (plan.kind === "current") {
    const rows = await committedByMonth(db, cur);
    const inForm = new Set(categoryIds);
    const others = rows.filter((r) => r.yearMonth !== ym || !inForm.has(r.categoryId)).reduce((a, r) => a + Math.max(r.remaining, 0), 0);
    const deltas = Object.fromEntries(rows.filter((r) => r.yearMonth === ym).map((r) => [r.categoryId, r.delta]));
    return { kind: "current" as const, base: plan.inAccounts + plan.expected - thisMonthExpected - others, deltas };
  }
  if (plan.kind === "future") {
    return { kind: "future" as const, base: plan.carriedIn + (plan.income - thisMonthExpected), deltas: {} as Record<string, number> };
  }
  return null;
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

/** Accounts page: balances, free money, and every movement in or out of an account. */
export async function getMoneyPage(db: Db) {
  const cur = currentYearMonth();
  const [settings, accountList, free, committed, expected, entries, incomeIn, spendDays, catalog] = await Promise.all([
    getSettings(db),
    getAccounts(db),
    getSavingsBalance(db, cur),
    committedByMonth(db, cur),
    db
      .select({ source: incomes.source, amount: incomes.amount, yearMonth: months.yearMonth })
      .from(incomes)
      .innerJoin(months, eq(months.id, incomes.monthId))
      .where(and(eq(incomes.status, "expected"), lte(months.yearMonth, addMonths(cur, 1))))
      .orderBy(asc(months.yearMonth)),
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
      .where(and(isNotNull(expenses.accountId), gte(expenses.spentOn, firstDay(addMonths(cur, -2)))))
      .groupBy(expenses.accountId, expenses.spentOn),
    getCatalog(db),
  ]);

  const KIND = { opening: "Opening balance", adjustment: "Correction", transfer: "Transfer" } as const;
  const ledger = [
    ...entries.map((e) => ({ key: e.id, accountId: e.accountId, date: e.date, what: e.note ?? KIND[e.kind], type: KIND[e.kind], amount: e.amount })),
    ...incomeIn.map((i) => ({ key: i.id, accountId: i.accountId!, date: i.date!, what: i.source, type: "Income", amount: i.amount })),
    ...spendDays.map((d) => ({
      key: `x-${d.accountId}-${d.date}`,
      accountId: d.accountId!,
      date: d.date,
      what: `${d.n} expense${d.n === 1 ? "" : "s"}`,
      type: "Spending",
      amount: -d.total,
    })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return {
    currency: settings.currencySymbol,
    ym: cur,
    accounts: accountList,
    defaultAccountId: settings.defaultAccountId,
    free,
    leftToSpend: committed.reduce((a, r) => a + Math.max(r.remaining, 0), 0),
    expected,
    ledger,
    categories: catalog.categories,
  };
}

/** Spending by day, week (Mon–Sun) and month, with a category split for each bucket. */
export async function getSpending(db: Db) {
  const t = today();
  const from = firstDay(addMonths(monthOf(t), -11));
  const [settings, rows] = await Promise.all([
    getSettings(db),
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
  return {
    today: t,
    currency: settings.currencySymbol,
    rows: rows.map((r) => ({ ...r, name: r.name ?? "Needs category", color: r.color ?? "var(--faint)" })),
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
  const [income, plan, settings, catalog, budgets, prevBudgets, accountList] = await Promise.all([
    getIncomes(db, month),
    getMonthPlan(db, ym),
    getSettings(db),
    getCatalog(db, month),
    month ? db.select().from(categoryBudgets).where(eq(categoryBudgets.monthId, month.id)) : [],
    prev ? db.select().from(categoryBudgets).where(eq(categoryBudgets.monthId, prev.id)) : [],
    getAccounts(db),
  ]);
  const byCat = new Map(budgets.map((b) => [b.categoryId, b]));
  const planBase = await getSetupPlanBase(
    db,
    ym,
    plan,
    income.filter((i) => i.status === "expected").reduce((a, i) => a + i.amount, 0),
    catalog.categories.map((c) => c.id),
  );
  return {
    ym,
    prevYm,
    month: monthInfo(month),
    currencySymbol: settings.currencySymbol,
    currencyCode: settings.currencyCode,
    defaultAlertPct: month?.defaultAlertPct ?? settings.defaultAlertPct,
    incomes: income,
    plan,
    planBase,
    accounts: accountList,
    defaultAccountId: settings.defaultAccountId,
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

