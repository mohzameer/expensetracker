import { inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { itemCompletions, items } from "@/db/schema";

/**
 * A category's cap is never typed in: it is the total of its items.
 *
 *   cap for a month = its monthly items' amounts + that month's one-off items' planned amounts
 *
 * A monthly item is left out of a month it was skipped for (item_skips) and of
 * every month after its last one (items.end_ym). As-needed items add nothing.
 * One marked complete for a month gives back what it released (item_completions),
 * never more than it still hasn't been paid.
 *
 * This is the only place `category_budgets.allocation` is written. It rewrites
 * every OPEN month (closed months keep the cap they closed with), for one
 * category or for all of them. Covers and "raise cap" sit on top as transfers.
 */
export async function syncCaps(db: Db, categoryId?: string) {
  await db.execute(sql`
    INSERT INTO category_budgets (month_id, category_id, allocation)
    SELECT m.id, c.id,
      coalesce((SELECT sum(i.expected_amount - CASE WHEN d.item_id IS NULL THEN 0 ELSE least(d.released, greatest(i.expected_amount - coalesce(
                  (SELECT sum(e.amount) FROM expenses e
                   WHERE e.item_id = i.id AND e.spent_on >= m.starts_on AND e.spent_on < m.ends_on), 0), 0)) END)
                FROM items i
                LEFT JOIN item_completions d ON d.item_id = i.id AND d.month_id = m.id
                WHERE i.category_id = c.id AND i.kind = 'monthly' AND i.archived_at IS NULL
                  AND (i.end_ym IS NULL OR m.year_month <= i.end_ym)
                  AND NOT EXISTS (SELECT 1 FROM item_skips s WHERE s.item_id = i.id AND s.month_id = m.id)), 0)
      + coalesce((SELECT sum(coalesce(i.default_amount, 0)) FROM items i
                  WHERE i.category_id = c.id AND i.kind = 'one_off' AND i.month_id = m.id AND i.archived_at IS NULL), 0)
    FROM months m
    CROSS JOIN categories c
    WHERE m.status = 'open'
      AND c.archived_at IS NULL
      ${categoryId ? sql`AND c.id = ${categoryId}` : sql``}
    ON CONFLICT (month_id, category_id) DO UPDATE SET allocation = EXCLUDED.allocation`);
}

/** A payment on an item changed: a month it's marked complete in gives back no more than is still unpaid. */
export async function syncCapsForPaidItems(db: Db, itemIds: (string | null | undefined)[]) {
  const ids = [...new Set(itemIds.filter((id): id is string => !!id))];
  if (!ids.length) return;
  const rows = await db
    .selectDistinct({ categoryId: items.categoryId })
    .from(itemCompletions)
    .innerJoin(items, sql`${items.id} = ${itemCompletions.itemId}`)
    .where(inArray(itemCompletions.itemId, ids));
  for (const r of rows) await syncCaps(db, r.categoryId);
}
