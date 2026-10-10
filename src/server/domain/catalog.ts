import { and, asc, eq, gt, isNull, lt, max, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { categories, categoryBudgets, expenses, incomes, items, itemSkips, months, settings, transfers } from "@/db/schema";
import { formatMonth } from "@/lib/dates";
import { UserError } from "@/lib/errors";
import { CATEGORY_COLORS } from "@/lib/palette";
import { syncCaps } from "./caps";
import { assertOpen, ensureMonth, lockMonth } from "./months";

export type NewCategory = { name: string; color?: string | null; alertPct?: number | null; ym: string };

/** Create a category (inline from the entry sheet). Its cap comes from the items added to it. */
export async function createCategory(db: Db, input: NewCategory) {
  return db.transaction(async (tx) => {
    const month = await ensureMonth(tx, input.ym);
    assertOpen(month);
    const [{ n, top }] = await tx
      .select({ n: sql<number>`count(*)::int`, top: max(categories.sortOrder) })
      .from(categories);
    const [cat] = await tx
      .insert(categories)
      .values({
        name: input.name.trim(),
        color: input.color ?? CATEGORY_COLORS[Number(n) % CATEGORY_COLORS.length],
        sortOrder: (top ?? -1) + 1,
      })
      .returning();
    await tx.insert(categoryBudgets).values({ monthId: month.id, categoryId: cat.id, alertPct: input.alertPct ?? null });
    await syncCaps(tx, cat.id);
    return cat;
  });
}

export type NewItem = {
  categoryId: string;
  name: string;
  kind: "monthly" | "one_off";
  expectedAmount?: number | null;
  defaultAmount?: number | null;
  /** The month a one-off item is for (it won't appear in other months). */
  ym: string;
};

/** Items offered in a month: the monthly items still running in it, plus the one-offs added for that month. */
export async function itemsForMonth(db: Db, monthId: string | null) {
  const running = monthId
    ? and(eq(items.kind, "monthly"), or(isNull(items.endYm), sql`${items.endYm} >= (select year_month from months where id = ${monthId})`))
    : eq(items.kind, "monthly");
  return db
    .select({
      id: items.id,
      categoryId: items.categoryId,
      name: items.name,
      kind: items.kind,
      expectedAmount: items.expectedAmount,
      defaultAmount: items.defaultAmount,
      endYm: items.endYm,
    })
    .from(items)
    .where(and(isNull(items.archivedAt), monthId ? or(running, eq(items.monthId, monthId)) : running))
    .orderBy(asc(items.sortOrder), asc(items.name));
}

/**
 * A monthly item that already ran its course can be added again under the same name:
 * names are unique per category, so the ended item is restarted rather than duplicated.
 * The open months between its old end and `ym` are marked skipped, so restarting
 * doesn't put it back into them. Returns its id, or null when there is nothing to restart.
 */
async function restartEnded(db: Db, categoryId: string, name: string, ym: string): Promise<string | null> {
  const [ended] = await db
    .select({ id: items.id, endYm: items.endYm })
    .from(items)
    .where(
      and(eq(items.categoryId, categoryId), eq(items.kind, "monthly"), isNull(items.archivedAt), sql`lower(${items.name}) = ${name.trim().toLowerCase()}`, lt(items.endYm, ym)),
    );
  if (!ended) return null;
  const gap = await db.select({ id: months.id }).from(months).where(and(gt(months.yearMonth, ended.endYm!), lt(months.yearMonth, ym), eq(months.status, "open")));
  if (gap.length) await db.insert(itemSkips).values(gap.map((m) => ({ itemId: ended.id, monthId: m.id }))).onConflictDoNothing();
  return ended.id;
}

export async function createItem(db: Db, input: NewItem) {
  if (input.kind === "monthly" && !input.expectedAmount) throw new UserError("Monthly items need an expected amount.");
  if (input.kind === "monthly") {
    const restarted = await restartEnded(db, input.categoryId, input.name, input.ym);
    if (restarted) {
      const [item] = await db.update(items).set({ expectedAmount: input.expectedAmount, endYm: null }).where(eq(items.id, restarted)).returning();
      await syncCaps(db, input.categoryId);
      return item;
    }
  }
  const monthId = input.kind === "one_off" ? (await ensureMonth(db, input.ym)).id : null;
  const [{ top }] = await db.select({ top: max(items.sortOrder) }).from(items).where(eq(items.categoryId, input.categoryId));
  const [item] = await db
    .insert(items)
    .values({
      categoryId: input.categoryId,
      name: input.name.trim(),
      kind: input.kind,
      expectedAmount: input.kind === "monthly" ? input.expectedAmount : null,
      defaultAmount: input.kind === "one_off" ? (input.defaultAmount ?? null) : null,
      monthId,
      sortOrder: (top ?? -1) + 1,
    })
    .returning();
  await syncCaps(db, input.categoryId); // a new item raises its category's cap
  return item;
}

/** Items with history are archived; unused ones are deleted. */
export async function removeItem(db: Db, id: string) {
  const [used] = await db.select({ id: expenses.id }).from(expenses).where(eq(expenses.itemId, id)).limit(1);
  if (used) await db.update(items).set({ archivedAt: new Date() }).where(eq(items.id, id));
  else await db.delete(items).where(eq(items.id, id));
}

/** Categories with history are archived; unused ones are deleted. */
export async function removeCategory(db: Db, id: string) {
  const [spent] = await db.select({ id: expenses.id }).from(expenses).where(eq(expenses.categoryId, id)).limit(1);
  const [moved] = await db
    .select({ id: transfers.id })
    .from(transfers)
    .where(or(eq(transfers.fromCategoryId, id), eq(transfers.toCategoryId, id)))
    .limit(1);
  const [inClosed] = await db
    .select({ id: categoryBudgets.categoryId })
    .from(categoryBudgets)
    .innerJoin(months, eq(months.id, categoryBudgets.monthId))
    .where(and(eq(categoryBudgets.categoryId, id), eq(months.status, "closed")))
    .limit(1);

  if (!spent && !moved && !inClosed) {
    await db.delete(categories).where(eq(categories.id, id));
    return;
  }
  const now = new Date();
  await db.update(categories).set({ archivedAt: now }).where(eq(categories.id, id));
  await db.update(items).set({ archivedAt: now }).where(and(eq(items.categoryId, id), isNull(items.archivedAt)));
  // Drop its caps in open months where nothing happened, so it stops showing up.
  await db.execute(sql`
    DELETE FROM category_budgets b USING months m
    WHERE b.month_id = m.id AND m.status = 'open' AND b.category_id = ${id}
      AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.category_id = ${id}
        AND e.spent_on >= m.starts_on AND e.spent_on < m.ends_on)
      AND NOT EXISTS (SELECT 1 FROM transfers t WHERE t.month_id = m.id
        AND (t.from_category_id = ${id} OR t.to_category_id = ${id}))`);
}

export type SetupItem = {
  id: string | null;
  name: string;
  kind: "monthly" | "one_off";
  expectedAmount: number | null;
  defaultAmount: number | null;
  /** Monthly items only: leave it out of this month (no cap, not due). */
  skipped?: boolean;
  /** Monthly items only: the last month it counts in; null = until stopped. Left as it is when omitted. */
  endYm?: string | null;
  removed: boolean;
};

export type SetupCategory = {
  id: string | null;
  name: string;
  color: string;
  alertPct: number | null;
  removed: boolean;
  items: SetupItem[];
};

export type SetupPayload = {
  ym: string;
  defaultAlertPct: number;
  currencySymbol: string;
  currencyCode: string;
  categories: SetupCategory[];
  /** The month's expected income lines (replaces the expected ones; received lines are kept). Omit to leave income untouched. */
  incomes?: { source: string; amount: number; accountId: string | null }[];
  /** "Paid from" default for new expenses. */
  defaultAccountId?: string | null;
  /** Day budget months start on (1–28). Only months created afterwards use it. */
  periodStartDay?: number;
};

/** Setup's single "Save all": everything in one transaction. */
export async function saveSetup(db: Db, p: SetupPayload) {
  return db.transaction(async (tx) => {
    const month = await lockMonth(tx, p.ym);
    assertOpen(month);

    await tx.update(settings).set({ currencySymbol: p.currencySymbol, currencyCode: p.currencyCode }).where(eq(settings.id, 1));
    await tx.update(months).set({ defaultAlertPct: p.defaultAlertPct }).where(eq(months.id, month.id));

    if (p.periodStartDay !== undefined) {
      await tx.update(settings).set({ periodStartDay: p.periodStartDay }).where(eq(settings.id, 1));
    }
    if (p.defaultAccountId !== undefined) {
      await tx.update(settings).set({ defaultAccountId: p.defaultAccountId }).where(eq(settings.id, 1));
    }
    if (p.incomes) {
      await tx.delete(incomes).where(and(eq(incomes.monthId, month.id), eq(incomes.status, "expected")));
      if (p.incomes.length) {
        await tx.insert(incomes).values(
          p.incomes.map((i, n) => ({
            monthId: month.id,
            source: i.source.trim(),
            amount: i.amount,
            accountId: i.accountId,
            sortOrder: 100 + n,
          })),
        );
      }
    }

    const removedCats = p.categories.filter((c) => c.removed && c.id).map((c) => c.id!);
    for (const id of removedCats) await removeCategory(tx, id);

    let order = 0;
    for (const c of p.categories) {
      if (c.removed) continue;
      let categoryId = c.id;
      if (categoryId) {
        await tx
          .update(categories)
          .set({ name: c.name.trim(), color: c.color, sortOrder: order })
          .where(eq(categories.id, categoryId));
      } else {
        const [row] = await tx.insert(categories).values({ name: c.name.trim(), color: c.color, sortOrder: order }).returning();
        categoryId = row.id;
      }
      order++;

      // Only the alert % is set here; the cap itself is derived from the items below.
      await tx
        .insert(categoryBudgets)
        .values({ monthId: month.id, categoryId, alertPct: c.alertPct })
        .onConflictDoUpdate({
          target: [categoryBudgets.monthId, categoryBudgets.categoryId],
          set: { alertPct: c.alertPct },
        });

      const removedItems = c.items.filter((i) => i.removed && i.id).map((i) => i.id!);
      for (const id of removedItems) await removeItem(tx, id);

      let itemOrder = 0;
      for (const it of c.items) {
        if (it.removed) continue;
        if (it.kind === "monthly" && !it.expectedAmount) throw new UserError(`${it.name}: monthly items need an expected amount.`);
        const values = {
          name: it.name.trim(),
          kind: it.kind,
          expectedAmount: it.kind === "monthly" ? it.expectedAmount : null,
          defaultAmount: it.kind === "one_off" ? it.defaultAmount : null,
          // One-offs belong to this month; switching an item to monthly makes it carry over.
          monthId: it.kind === "one_off" ? month.id : null,
          // How long a monthly item runs. A one-off never has an end month.
          ...(it.kind === "one_off" ? { endYm: null } : it.endYm !== undefined ? { endYm: it.endYm } : {}),
          sortOrder: itemOrder++,
        };
        if (it.kind === "monthly" && it.endYm && it.endYm < p.ym) {
          throw new UserError(`${it.name}: it can't stop before ${formatMonth(p.ym, { month: "long" })}.`);
        }
        let itemId = it.id;
        if (!itemId && it.kind === "monthly") itemId = await restartEnded(tx, categoryId, it.name, p.ym);
        if (itemId) await tx.update(items).set(values).where(and(eq(items.id, itemId), eq(items.categoryId, categoryId)));
        else [{ id: itemId }] = await tx.insert(items).values({ ...values, categoryId }).returning({ id: items.id });
        // Skipping is per month and only means something for a monthly item.
        if (it.kind === "monthly" && it.skipped) {
          await tx.insert(itemSkips).values({ itemId: itemId!, monthId: month.id }).onConflictDoNothing();
        } else {
          await tx.delete(itemSkips).where(and(eq(itemSkips.itemId, itemId!), eq(itemSkips.monthId, month.id)));
        }
      }
    }
    await syncCaps(tx); // caps = item totals, for every open month
    return { ok: true };
  });
}

/** Categories to leave out of the spending charts (saved for every device). */
export async function setChartHiddenCategories(db: Db, ids: string[]) {
  await db.update(settings).set({ chartHiddenCategoryIds: [...new Set(ids)] }).where(eq(settings.id, 1));
}
