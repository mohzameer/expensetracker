import { addDays, addMonths, diffDays, dueDateIn, formatDay, formatMonth, periodEnd, periodOf, periodStart, weekStart, type Range } from "./dates";

/** One expense, as the Analysis page sees it. */
export type Row = {
  id: string;
  date: string;
  amount: number;
  note: string | null;
  categoryId: string | null;
  categoryName: string | null;
  color: string | null;
  itemName: string | null;
  accountId: string | null;
};

/** An item with its planned amount. One-offs belong to one budget month (`ym`). */
export type ItemRef = {
  categoryId: string;
  name: string;
  kind: "monthly" | "one_off";
  expectedAmount: number | null;
  defaultAmount: number | null;
  /** Day of the month a monthly item is due, if it has one. */
  dueDay: number | null;
  ym: string | null;
  archived: boolean;
  createdOn: string;
};

export type CategoryRef = { id: string; name: string; color: string; archived?: boolean };

export type Preset = "month" | "week" | "last_month" | "last_3" | "year" | "custom";

/**
 * Items are identified by category + name, not by row: a one-off such as "Uber" is a
 * new row every month, and its history should still read as one item.
 * Spending without an item gets the category's own key (empty name).
 */
export function itemKey(categoryId: string | null, name: string | null): string {
  return `${categoryId ?? "none"}:${(name ?? "").trim().toLowerCase()}`;
}

export const rowKey = (r: Row) => itemKey(r.categoryId, r.itemName);

/** Range for a preset; `to` is exclusive. Months are budget months, weeks run Mon–Sun. */
export function presetRange(preset: Exclude<Preset, "custom">, today: string, startDay: number): Range {
  const cur = periodOf(today, startDay);
  switch (preset) {
    case "week":
      return { from: weekStart(today), to: addDays(weekStart(today), 7) };
    case "last_month":
      return { from: periodStart(addMonths(cur, -1), startDay), to: periodStart(cur, startDay) };
    case "last_3":
      return { from: periodStart(addMonths(cur, -2), startDay), to: periodEnd(cur, startDay) };
    case "year":
      return { from: periodStart(addMonths(cur, -11), startDay), to: periodEnd(cur, startDay) };
    default:
      return { from: periodStart(cur, startDay), to: periodEnd(cur, startDay) };
  }
}

/** The budget month a range covers exactly, or null (planned amounts only make sense per month). */
export function monthOfRange(r: Range, startDay: number): string | null {
  const ym = periodOf(r.from, startDay);
  return periodStart(ym, startDay) === r.from && periodEnd(ym, startDay) === r.to ? ym : null;
}

export const inRange = (date: string, r: Range) => date >= r.from && date < r.to;

const sumOf = (rows: Row[]) => rows.reduce((a, r) => a + r.amount, 0);

/** Days that have entries, newest first. */
export function groupByDay(rows: Row[]): { date: string; total: number; rows: Row[] }[] {
  const days = new Map<string, Row[]>();
  for (const r of rows) days.set(r.date, [...(days.get(r.date) ?? []), r]);
  return [...days.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, list]) => ({ date, total: sumOf(list), rows: list }));
}

export type Bar = { label: string; detail: string; value: number; muted?: boolean };

/** Bars for a range: one per day up to 31 days, one per week beyond that. Never past today. */
export function rangeBars(rows: Row[], range: Range, today: string): Bar[] {
  const end = range.to > addDays(today, 1) ? addDays(today, 1) : range.to; // exclusive
  const days = Math.max(diffDays(end, range.from), 0);
  const short = (d: string) => formatDay(d, { day: "numeric", month: "short" });
  if (days <= 31) {
    return Array.from({ length: days }, (_, i) => {
      const d = addDays(range.from, i);
      return { label: String(Number(d.slice(8))), detail: formatDay(d), value: sumOf(rows.filter((r) => r.date === d)) };
    });
  }
  const bars: Bar[] = [];
  for (let from = weekStart(range.from); from < end; from = addDays(from, 7)) {
    const to = addDays(from, 7);
    bars.push({
      label: short(from),
      detail: `${short(from)} – ${short(addDays(to, -1))}`,
      value: sumOf(rows.filter((r) => r.date >= from && r.date < to && inRange(r.date, range))),
    });
  }
  return bars;
}

export type MonthBucket = { ym: string; label: string; total: number; count: number; current: boolean };

/**
 * The last `n` budget months. The average covers finished months only, starting from
 * the first month with spending, so a new item isn't dragged down by months before it existed.
 */
export function monthBuckets(rows: Row[], today: string, startDay: number, n = 12): { months: MonthBucket[]; average: number | null } {
  const cur = periodOf(today, startDay);
  const months = Array.from({ length: n }, (_, i) => {
    const ym = addMonths(cur, i - (n - 1));
    const list = rows.filter((r) => inRange(r.date, { from: periodStart(ym, startDay), to: periodEnd(ym, startDay) }));
    return { ym, label: formatMonth(ym, { month: "short" }).slice(0, 3), total: sumOf(list), count: list.length, current: ym === cur };
  });
  const first = months.findIndex((m) => m.total > 0);
  const finished = first < 0 ? [] : months.slice(first).filter((m) => !m.current);
  return { months, average: finished.length ? Math.round(finished.reduce((a, m) => a + m.total, 0) / finished.length) : null };
}

type CycleItem = {
  key: string;
  categoryId: string;
  name: string;
  kind: "monthly" | "one_off";
  dueDay: number | null;
  planned: number | null;
  /** Position in Setup's order. */
  order: number;
  /** Worth listing even with nothing spent: planned, still in use, and it existed by then. */
  listable: boolean;
};

/**
 * The items that belong to budget month `ym`, by key: every monthly item plus that
 * month's one-offs. Planned = a monthly item's expected amount, or the one-off's amount.
 */
function cycleItems(items: ItemRef[], categories: CategoryRef[], ym: string, startDay: number): Map<string, CycleItem> {
  const live = new Set(categories.filter((c) => !c.archived).map((c) => c.id));
  const end = periodEnd(ym, startDay);
  const out = new Map<string, CycleItem>();
  items.forEach((it, order) => {
    if (it.kind === "one_off" && it.ym !== ym) return;
    const key = itemKey(it.categoryId, it.name);
    const amount = it.kind === "monthly" ? it.expectedAmount : it.defaultAmount;
    const listable = amount != null && !it.archived && live.has(it.categoryId) && (it.kind === "one_off" || it.createdOn < end);
    const cur = out.get(key);
    if (cur) {
      // A monthly item and a one-off with the same name: one line, amounts added.
      if (amount != null) cur.planned = (cur.planned ?? 0) + amount;
      cur.listable ||= listable;
      cur.dueDay ??= it.kind === "monthly" ? it.dueDay : null;
    } else {
      out.set(key, { key, categoryId: it.categoryId, name: it.name, kind: it.kind, dueDay: it.kind === "monthly" ? it.dueDay : null, planned: amount, order, listable });
    }
  });
  return out;
}

export type TopItem = {
  key: string;
  categoryId: string | null;
  categoryName: string;
  color: string;
  /** null = spending in the category without an item. */
  name: string | null;
  total: number;
  count: number;
  share: number; // 0–1 of everything in the list
  planned: number | null;
};

/**
 * Items ranked by spend. With `ym` (a single budget month) each gets its planned amount,
 * and items that were planned but not spent on are listed too.
 */
export function topItems(rows: Row[], items: ItemRef[], categories: CategoryRef[], ym: string | null, startDay: number): TopItem[] {
  const out = new Map<string, TopItem>();
  for (const r of rows) {
    const key = rowKey(r);
    const cur = out.get(key) ?? {
      key,
      categoryId: r.categoryId,
      categoryName: r.categoryName ?? "Needs category",
      color: r.color ?? "var(--faint)",
      name: r.itemName,
      total: 0,
      count: 0,
      share: 0,
      planned: null,
    };
    cur.total += r.amount;
    cur.count += 1;
    out.set(key, cur);
  }
  if (ym) {
    const catOf = new Map(categories.map((c) => [c.id, c]));
    for (const it of cycleItems(items, categories, ym, startDay).values()) {
      if (it.planned == null) continue;
      const spent = out.get(it.key);
      if (spent) spent.planned = it.planned;
      else if (it.listable) {
        const cat = catOf.get(it.categoryId)!;
        out.set(it.key, { key: it.key, categoryId: it.categoryId, categoryName: cat.name, color: cat.color, name: it.name, total: 0, count: 0, share: 0, planned: it.planned });
      }
    }
  }
  const list = [...out.values()];
  const total = list.reduce((a, t) => a + t.total, 0);
  for (const t of list) t.share = total ? t.total / total : 0;
  return list.sort((a, b) => b.total - a.total || (b.planned ?? 0) - (a.planned ?? 0) || a.key.localeCompare(b.key));
}

export type GridItem = {
  key: string;
  /** null = spending in the category without an item. */
  name: string | null;
  kind: "monthly" | "one_off" | null;
  dueDate: string | null;
  /** Distinct days it was paid on, oldest first. */
  paidOn: string[];
  planned: number | null;
  spent: number;
};
export type GridCategory = { id: string | null; name: string; color: string; planned: number; spent: number; items: GridItem[] };

/**
 * One budget month as a table: every item that was planned or spent on, under its category
 * (in Setup's order), with due date, the days it was paid, planned and spent. Uncategorised
 * spending comes last.
 */
export function cycleGrid(rows: Row[], items: ItemRef[], categories: CategoryRef[], ym: string, startDay: number): { categories: GridCategory[]; planned: number; spent: number } {
  const range = { from: periodStart(ym, startDay), to: periodEnd(ym, startDay) };
  const meta = cycleItems(items, categories, ym, startDay);
  const lines = new Map<string, GridItem & { categoryId: string | null; order: number }>();
  for (const it of meta.values()) {
    if (!it.listable) continue;
    lines.set(it.key, {
      key: it.key, categoryId: it.categoryId, name: it.name, kind: it.kind, order: it.order,
      dueDate: it.dueDay ? dueDateIn(range, it.dueDay) : null, paidOn: [], planned: it.planned, spent: 0,
    });
  }
  const seen = new Map<string | null, { name: string; color: string }>();
  for (const r of rows) {
    if (!inRange(r.date, range)) continue;
    seen.set(r.categoryId, { name: r.categoryName ?? "Needs category", color: r.color ?? "var(--faint)" });
    const key = rowKey(r);
    const m = meta.get(key);
    const line = lines.get(key) ?? {
      key, categoryId: r.categoryId, name: r.itemName, kind: m?.kind ?? null,
      // Items first (Setup's order), then spending without an item.
      order: m?.order ?? (r.itemName ? items.length : items.length + 1),
      dueDate: m?.dueDay ? dueDateIn(range, m.dueDay) : null, paidOn: [], planned: m?.planned ?? null, spent: 0,
    };
    line.spent += r.amount;
    if (!line.paidOn.includes(r.date)) line.paidOn.push(r.date);
    lines.set(key, line);
  }
  const groups: GridCategory[] = [];
  const order: (CategoryRef | null)[] = [...categories, ...(seen.has(null) ? [null] : [])];
  for (const c of order) {
    const id = c?.id ?? null;
    const list = [...lines.values()]
      .filter((l) => l.categoryId === id)
      .sort((a, b) => a.order - b.order || (a.name ?? "").localeCompare(b.name ?? ""))
      .map((l): GridItem => ({ key: l.key, name: l.name, kind: l.kind, dueDate: l.dueDate, paidOn: [...l.paidOn].sort(), planned: l.planned, spent: l.spent }));
    if (!list.length) continue;
    groups.push({
      id,
      name: c?.name ?? "Needs category",
      color: c?.color ?? seen.get(null)?.color ?? "var(--faint)",
      planned: list.reduce((a, l) => a + (l.planned ?? 0), 0),
      spent: list.reduce((a, l) => a + l.spent, 0),
      items: list,
    });
  }
  return { categories: groups, planned: groups.reduce((a, g) => a + g.planned, 0), spent: groups.reduce((a, g) => a + g.spent, 0) };
}

export type Search = { q: string; categoryId: string | null; accountId: string | null; range: Range };

/** Entries matching the text (in the note, item or category name) and filters, newest first. `accountId: "none"` = not deducted. */
export function searchRows(rows: Row[], s: Search): Row[] {
  const q = s.q.trim().toLowerCase();
  return rows
    .filter((r) => inRange(r.date, s.range))
    .filter((r) => !s.categoryId || r.categoryId === s.categoryId)
    .filter((r) => !s.accountId || (s.accountId === "none" ? r.accountId === null : r.accountId === s.accountId))
    .filter((r) => !q || [r.note, r.itemName, r.categoryName].some((t) => t?.toLowerCase().includes(q)))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
