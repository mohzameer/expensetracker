import { and, eq, isNull, max, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { categories, categoryBudgets, expenses, items, months, settings, transfers } from "@/db/schema";
import { UserError } from "@/lib/errors";
import { assertOpen, ensureMonth, lockMonth } from "./months";

export const CATEGORY_COLORS = ["#1F5F5B", "#E08A3C", "#6FA9A1", "#7A6FB0", "#F2C28B", "#C9C3E6", "#B5533C", "#8A9A5B", "#4C7FA8", "#D4A017"];

export type NewCategory = { name: string; color?: string | null; allocation?: number | null; alertPct?: number | null; ym: string };

/** Create a category (inline from the entry sheet) with this month's cap. */
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
    await tx.insert(categoryBudgets).values({
      monthId: month.id,
      categoryId: cat.id,
      allocation: input.allocation ?? 0,
      alertPct: input.alertPct ?? null,
    });
    return cat;
  });
}

export type NewItem = {
  categoryId: string;
  name: string;
  kind: "monthly" | "one_off";
  expectedAmount?: number | null;
  defaultAmount?: number | null;
};

export async function createItem(db: Db, input: NewItem) {
  if (input.kind === "monthly" && !input.expectedAmount) throw new UserError("Monthly items need an expected amount.");
  const [{ top }] = await db.select({ top: max(items.sortOrder) }).from(items).where(eq(items.categoryId, input.categoryId));
  const [item] = await db
    .insert(items)
    .values({
      categoryId: input.categoryId,
      name: input.name.trim(),
      kind: input.kind,
      expectedAmount: input.kind === "monthly" ? input.expectedAmount : null,
      defaultAmount: input.kind === "one_off" ? (input.defaultAmount ?? null) : null,
      sortOrder: (top ?? -1) + 1,
    })
    .returning();
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
        AND e.spent_on >= m.starts_on AND e.spent_on < m.starts_on + interval '1 month')
      AND NOT EXISTS (SELECT 1 FROM transfers t WHERE t.month_id = m.id
        AND (t.from_category_id = ${id} OR t.to_category_id = ${id}))`);
}

export type SetupItem = {
  id: string | null;
  name: string;
  kind: "monthly" | "one_off";
  expectedAmount: number | null;
  defaultAmount: number | null;
  removed: boolean;
};

export type SetupCategory = {
  id: string | null;
  name: string;
  color: string;
  allocation: number;
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
};

/** Setup's single "Save all": everything in one transaction. */
export async function saveSetup(db: Db, p: SetupPayload) {
  return db.transaction(async (tx) => {
    const month = await lockMonth(tx, p.ym);
    assertOpen(month);

    await tx.update(settings).set({ currencySymbol: p.currencySymbol, currencyCode: p.currencyCode }).where(eq(settings.id, 1));
    await tx.update(months).set({ defaultAlertPct: p.defaultAlertPct }).where(eq(months.id, month.id));

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

      await tx
        .insert(categoryBudgets)
        .values({ monthId: month.id, categoryId, allocation: c.allocation, alertPct: c.alertPct })
        .onConflictDoUpdate({
          target: [categoryBudgets.monthId, categoryBudgets.categoryId],
          set: { allocation: c.allocation, alertPct: c.alertPct },
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
          sortOrder: itemOrder++,
        };
        if (it.id) await tx.update(items).set(values).where(and(eq(items.id, it.id), eq(items.categoryId, categoryId)));
        else await tx.insert(items).values({ ...values, categoryId });
      }
    }
    return { ok: true };
  });
}
