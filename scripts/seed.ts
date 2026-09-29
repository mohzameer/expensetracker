/**
 * npm run db:seed        → starter categories, items and this month's caps
 * npm run db:seed:demo   → the same plus last month (closed) and sample spending
 */
import { config } from "dotenv";
config({ path: [".env.local", ".env"] });

import { createDb, type Db } from "../src/db/client";
import { categories } from "../src/db/schema";
import { addMonths, currentYearMonth, firstDay, lastDay, today } from "../src/lib/dates";
import { createCategory, createItem } from "../src/server/domain/catalog";
import { createExpense } from "../src/server/domain/expenses";
import { closeMonth, ensureMonth } from "../src/server/domain/months";
import { adjustSavings, moveToCategory } from "../src/server/domain/transfers";

const rs = (n: number) => Math.round(n * 100);

const CATALOG = [
  { name: "Groceries", color: "#1F5F5B", cap: 30000, items: [["Keells", "one_off"], ["Cargills", "one_off"], ["Market", "one_off"]] },
  { name: "Dining", color: "#E08A3C", cap: 12000, items: [["Lunch", "one_off", 1250], ["Coffee", "one_off", 500], ["Dinner out", "one_off"]] },
  { name: "Transport", color: "#6FA9A1", cap: 15000, items: [["PickMe", "one_off"], ["Fuel", "one_off"]] },
  { name: "Utilities", color: "#7A6FB0", cap: 18000, items: [["Electricity", "monthly", 6800], ["Water", "monthly", 1400], ["Internet", "monthly", 3990]] },
  { name: "Subscriptions", color: "#F2C28B", cap: 8000, items: [["Gym", "monthly", 6000], ["Streaming", "monthly", 1200]] },
  { name: "Health", color: "#C9C3E6", cap: 10000, items: [["Pharmacy", "one_off"], ["Doctor", "one_off"]] },
] as const;

async function seedCatalog(db: Db, ym: string) {
  const ids: Record<string, string> = {};
  for (const c of CATALOG) {
    const cat = await createCategory(db, { name: c.name, color: c.color, allocation: rs(c.cap), ym });
    ids[c.name] = cat.id;
    for (const [name, kind, amount] of c.items as readonly (readonly [string, "one_off" | "monthly", number?])[]) {
      const item = await createItem(db, {
        categoryId: cat.id,
        name,
        kind,
        expectedAmount: kind === "monthly" ? rs(amount!) : null,
        defaultAmount: kind === "one_off" && amount ? rs(amount) : null,
      });
      ids[`${c.name}/${name}`] = item.id;
    }
  }
  return ids;
}

async function seedDemo(db: Db, ids: Record<string, string>, prev: string, cur: string) {
  const t = today();
  const spend = (date: string, cat: string | null, amount: number, item?: string, note?: string) =>
    createExpense(db, {
      spentOn: date,
      categoryId: cat ? ids[cat] : null,
      itemId: cat && item ? ids[`${cat}/${item}`] : null,
      amount: rs(amount),
      note: note ?? null,
    });
  const day = (ym: string, d: number) => {
    const date = `${ym}-${String(d).padStart(2, "0")}`;
    return date > t ? t : date;
  };

  // Last month: a starting balance, ordinary spending, one cover, then close.
  await adjustSavings(db, { direction: "in", amount: rs(20000), note: "Starting balance", todayStr: firstDay(prev) });
  const p = [
    [2, "Groceries", 6200, "Keells"], [5, "Utilities", 6800, "Electricity"], [5, "Utilities", 1400, "Water"],
    [6, "Utilities", 3990, "Internet"], [7, "Subscriptions", 6000, "Gym"], [9, "Transport", 4200, "Fuel"],
    [12, "Dining", 5600, "Dinner out"], [15, "Groceries", 7400, "Cargills"], [18, "Dining", 8400, "Lunch"],
    [20, "Health", 2600, "Pharmacy"], [22, "Transport", 3100, "PickMe"], [25, "Groceries", 5800, "Market"],
    [27, "Subscriptions", 1200, "Streaming"], [31, "Groceries", 2200, "Keells"], [31, "Transport", 720, "PickMe"],
    [31, "Dining", 500, "Coffee"],
  ] as const;
  for (const [d, cat, amt, item] of p) await spend(day(prev, Math.min(d, Number(lastDay(prev).slice(8)))), cat, amt, item);
  await moveToCategory(db, {
    ym: prev, toCategoryId: ids.Dining, source: { kind: "savings" }, amount: rs(2500), todayStr: lastDay(prev),
  });
  await closeMonth(db, prev, lastDay(prev));

  // This month, up to today.
  const c = [
    [1, "Groceries", 5200, "Keells"], [2, "Utilities", 6800, "Electricity"], [3, "Transport", 4800, "Fuel"],
    [4, "Dining", 3400, "Dinner out"], [6, "Utilities", 2000, "Internet"], [8, "Groceries", 6150, "Cargills"],
    [9, "Subscriptions", 1400, "Streaming"], [10, "Health", 2400, "Pharmacy"], [11, "Dining", 2900, "Lunch"],
    [13, "Transport", 3600, "PickMe"], [15, "Groceries", 3400, "Market"], [16, "Utilities", 1050, "Water"],
    [17, "Dining", 3300, "Dinner out"], [19, "Subscriptions", 1200, "Streaming"], [22, "Transport", 2000, "PickMe"],
    [24, "Dining", 2500, "Lunch"],
  ] as const;
  for (const [d, cat, amt, item] of c) await spend(day(cur, d), cat, amt, item);
  const todayEntries = [["Groceries", 2850, "Keells"], ["Transport", 1500, "PickMe"], ["Dining", 1250, "Lunch"]] as const;
  for (const [cat, amt, item] of todayEntries) await spend(t.startsWith(cur) ? t : lastDay(cur), cat, amt, item);
  await spend(day(cur, 27), null, 780, undefined, "Cash · market");
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  const demo = process.argv.includes("--demo");
  const db = await createDb(url);

  const existing = await db.select({ id: categories.id }).from(categories).limit(1);
  if (existing.length) {
    console.log("Categories already exist — nothing to seed.");
    process.exit(0);
  }

  const cur = currentYearMonth();
  const prev = addMonths(cur, -1);
  if (demo) {
    await ensureMonth(db, prev);
    const ids = await seedCatalog(db, prev);
    await seedDemo(db, ids, prev, cur);
  } else {
    await ensureMonth(db, cur);
    await seedCatalog(db, cur);
  }
  console.log(demo ? `Seeded demo data for ${prev} (closed) and ${cur}.` : `Seeded starter categories for ${cur}.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
