import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  pgView,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// All money is stored as integer minor units (cents). Balances are never stored;
// they are derived from rows through the views at the bottom of this file.
const money = (name?: string) =>
  name ? bigint(name, { mode: "number" }) : bigint({ mode: "number" });

export const settings = pgTable(
  "settings",
  {
    id: smallint().primaryKey().default(1),
    currencyCode: text().notNull().default("LKR"),
    currencySymbol: text().notNull().default("Rs"),
    defaultAlertPct: smallint().notNull().default(10),
  },
  () => [check("settings_singleton", sql`id = 1`)],
);

export const months = pgTable(
  "months",
  {
    id: uuid().primaryKey().defaultRandom(),
    yearMonth: char({ length: 7 }).notNull().unique(),
    startsOn: date({ mode: "string" })
      .notNull()
      .generatedAlwaysAs(
        sql`make_date(left(year_month, 4)::int, right(year_month, 2)::int, 1)`,
      ),
    status: text({ enum: ["open", "closed"] }).notNull().default("open"),
    closedAt: timestamp({ withTimezone: true }),
    defaultAlertPct: smallint().notNull().default(10),
  },
  (t) => [
    uniqueIndex("months_starts_on_idx").on(t.startsOn),
    check("months_year_month_format", sql`year_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check("months_status", sql`status in ('open', 'closed')`),
    check("months_alert_pct", sql`default_alert_pct between 0 and 100`),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    color: text().notNull().default("#1F5F5B"),
    sortOrder: integer().notNull().default(0),
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  () => [uniqueIndex("categories_name_lower_idx").on(sql`lower(name)`)],
);

export const categoryBudgets = pgTable(
  "category_budgets",
  {
    monthId: uuid()
      .notNull()
      .references(() => months.id),
    categoryId: uuid()
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    allocation: money().notNull().default(0),
    alertPct: smallint(), // null → month default
  },
  (t) => [
    primaryKey({ columns: [t.monthId, t.categoryId] }),
    check("category_budgets_allocation", sql`allocation >= 0`),
    check("category_budgets_alert_pct", sql`alert_pct is null or alert_pct between 0 and 100`),
  ],
);

export const items = pgTable(
  "items",
  {
    id: uuid().primaryKey().defaultRandom(),
    categoryId: uuid()
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    name: text().notNull(),
    kind: text({ enum: ["monthly", "one_off"] }).notNull(),
    expectedAmount: money(), // monthly items
    defaultAmount: money(), // one-off prefill
    sortOrder: integer().notNull().default(0),
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("items_category_name_lower_idx").on(t.categoryId, sql`lower(name)`),
    // Target of the composite FK on expenses, so an expense's item always
    // belongs to the expense's category.
    unique("items_id_category_uq").on(t.id, t.categoryId),
    check("items_kind", sql`kind in ('monthly', 'one_off')`),
    check("items_monthly_expected", sql`kind <> 'monthly' or expected_amount is not null`),
    check("items_expected_positive", sql`expected_amount is null or expected_amount > 0`),
    check("items_default_positive", sql`default_amount is null or default_amount > 0`),
  ],
);

export const expenses = pgTable(
  "expenses",
  {
    id: uuid().primaryKey().defaultRandom(),
    spentOn: date({ mode: "string" }).notNull(),
    categoryId: uuid().references(() => categories.id), // null → needs category
    itemId: uuid(),
    amount: money().notNull(),
    note: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "expenses_item_category_fk",
      columns: [t.itemId, t.categoryId],
      foreignColumns: [items.id, items.categoryId],
    }),
    check("expenses_amount_positive", sql`amount > 0`),
    check("expenses_item_needs_category", sql`item_id is null or category_id is not null`),
    index("expenses_spent_on_idx").on(t.spentOn),
    index("expenses_category_spent_on_idx").on(t.categoryId, t.spentOn),
    index("expenses_item_spent_on_idx").on(t.itemId, t.spentOn),
  ],
);

export const transferKinds = ["category", "savings", "external"] as const;
export const transferReasons = ["cover", "month_close", "manual"] as const;

export const transfers = pgTable(
  "transfers",
  {
    id: uuid().primaryKey().defaultRandom(),
    monthId: uuid()
      .notNull()
      .references(() => months.id),
    fromKind: text({ enum: transferKinds }).notNull(),
    fromCategoryId: uuid().references(() => categories.id),
    toKind: text({ enum: transferKinds }).notNull(),
    toCategoryId: uuid().references(() => categories.id),
    amount: money().notNull(),
    reason: text({ enum: transferReasons }).notNull(),
    note: text(),
    occurredOn: date({ mode: "string" }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("transfers_amount_positive", sql`amount > 0`),
    check("transfers_from_kind", sql`from_kind in ('category', 'savings', 'external')`),
    check("transfers_to_kind", sql`to_kind in ('category', 'savings', 'external')`),
    check("transfers_reason", sql`reason in ('cover', 'month_close', 'manual')`),
    check("transfers_from_category", sql`(from_kind = 'category') = (from_category_id is not null)`),
    check("transfers_to_category", sql`(to_kind = 'category') = (to_category_id is not null)`),
    check(
      "transfers_distinct_ends",
      sql`from_kind <> to_kind or (from_kind = 'category' and from_category_id <> to_category_id)`,
    ),
    // `external` is only for manual Savings adjustments (starting balance, withdrawals).
    check(
      "transfers_external_with_savings",
      sql`(from_kind <> 'external' or to_kind = 'savings') and (to_kind <> 'external' or from_kind = 'savings')`,
    ),
    index("transfers_month_idx").on(t.monthId),
  ],
);

/** Expected income for a month, line by line (salary, commission, …). */
export const incomes = pgTable(
  "incomes",
  {
    id: uuid().primaryKey().defaultRandom(),
    monthId: uuid()
      .notNull()
      .references(() => months.id),
    source: text().notNull(),
    amount: money().notNull(),
    sortOrder: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("incomes_amount_positive", sql`amount > 0`), index("incomes_month_idx").on(t.monthId)],
);

// ---- Derived views (created in drizzle/0001_views_triggers.sql) ----

/** Per month and category: allocation, transfers, spend and remaining balance. */
export const categoryMonthSummary = pgView("category_month_summary", {
  monthId: uuid().notNull(),
  yearMonth: char({ length: 7 }).notNull(),
  categoryId: uuid().notNull(),
  name: text().notNull(),
  color: text().notNull(),
  sortOrder: integer().notNull(),
  archivedAt: timestamp({ withTimezone: true }),
  allocation: money().notNull(),
  alertPct: smallint().notNull(),
  transfersIn: money().notNull(),
  transfersOut: money().notNull(),
  effectiveAllocation: money().notNull(),
  spent: money().notNull(),
  remaining: money().notNull(), // before the month-close sweep
  swept: money().notNull(),
}).existing();

/** Per month and monthly item: expected, paid so far and status. */
export const monthlyItemStatus = pgView("monthly_item_status", {
  monthId: uuid().notNull(),
  yearMonth: char({ length: 7 }).notNull(),
  itemId: uuid().notNull(),
  categoryId: uuid().notNull(),
  name: text().notNull(),
  expected: money().notNull(),
  paid: money().notNull(),
  status: text({ enum: ["unpaid", "partial", "paid"] }).notNull(),
}).existing();

export const savingsBalance = pgView("savings_balance", {
  balance: money().notNull(),
}).existing();
