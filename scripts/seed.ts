/**
 * npm run db:seed        → starter categories and items (a category's cap is the total of its items)
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
import { moveToCategory } from "../src/server/domain/transfers";
import { createAccount } from "../src/server/domain/accounts";

const rs = (n: number) => Math.round(n * 100);

const CATALOG = [
  { name: "Groceries", color: "#00897B", items: [["Keells", "monthly", 12000], ["Cargills", "monthly", 10000], ["Market", "monthly", 8000]] },
  { name: "Dining", color: "#E2682F", items: [["Lunch", "monthly", 6000], ["Coffee", "monthly", 2000], ["Dinner out", "monthly", 4000]] },
  { name: "Transport", color: "#5E52B8", items: [["PickMe", "monthly", 6000], ["Fuel", "monthly", 9000]] },
  { name: "Utilities", color: "#DB9E00", items: [["Electricity", "monthly", 6800], ["Water", "monthly", 1400], ["Internet", "monthly", 3990]] },
  { name: "Subscriptions", color: "#D35C93", items: [["Gym", "monthly", 6000], ["Streaming", "monthly", 1200]] },
  { name: "Health", color: "#2E8B3E", items: [["Pharmacy", "monthly", 6000], ["Doctor", "one_off", 4000]] },
] as const;

async function seedCatalog(db: Db, ym: string) {
  const ids: Record<string, string> = {};
  for (const c of CATALOG) {
    const cat = await createCategory(db, { name: c.name, color: c.color, ym });
    ids[c.name] = cat.id;
    for (const [name, kind, amount] of c.items as readonly (readonly [string, "one_off" | "monthly", number?])[]) {
      const item = await createItem(db, {
        categoryId: cat.id,
        name,
        kind,
        expectedAmount: kind === "monthly" ? rs(amount!) : null,
        defaultAmount: kind === "one_off" && amount ? rs(amount) : null,
        ym,
      });
      ids[`${c.name}/${name}`] = item.id;
    }
  }
  return ids;
}

async function seedDemo(db: Db, ids: Record<string, string>, prev: string, cur: string) {
  const t = today();
  // One bank account that everything is paid from, opened at the start of last month.
  const bank = await createAccount(db, { name: "Bank", opening: rs(400000), todayStr: firstDay(prev) });
  const spend = (date: string, cat: string | null, amount: number, item?: string, note?: string) =>
    createExpense(db, {
      spentOn: date,
      categoryId: cat ? ids[cat] : null,
      itemId: cat && item ? ids[`${cat}/${item}`] : null,
      amount: rs(amount),
      note: note ?? null,
      accountId: bank.id,
    });
  const day = (ym: string, d: number) => {
    const date = `${ym}-${String(d).padStart(2, "0")}`;
    return date > t ? t : date;
  };

  // Last month: ordinary spending, one cover from free money, then close.
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
    // Expenses need an account to be paid from; set its real balance on the Accounts page.
    await createAccount(db, { name: "Bank", opening: 0, todayStr: today() });
  }
  console.log(demo ? `Seeded demo data for ${prev} (closed) and ${cur}.` : `Seeded starter categories for ${cur}.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
