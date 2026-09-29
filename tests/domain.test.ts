import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { categoryBudgets, categoryMonthSummary, expenses, incomes, monthlyItemStatus, months } from "@/db/schema";
import { closeBlockers, closeMonth, ensureMonth, getMonth } from "@/server/domain/months";
import { adjustSavings, getSavingsBalance, moveToCategory } from "@/server/domain/transfers";
import { receiveIncome, undoReceiveIncome } from "@/server/domain/incomes";
import { assignCategory, updateExpense } from "@/server/domain/expenses";
import { createItem, itemsForMonth, removeCategory, saveSetup } from "@/server/domain/catalog";
import { freshDb, rs, seedSeptember } from "./helpers";

let db: Db;
beforeEach(async () => {
  db = await freshDb();
});

async function summary(ym: string, categoryId: string) {
  const m = (await getMonth(db, ym))!;
  const [s] = await db
    .select()
    .from(categoryMonthSummary)
    .where(and(eq(categoryMonthSummary.monthId, m.id), eq(categoryMonthSummary.categoryId, categoryId)));
  return s;
}

describe("category summary", () => {
  it("remaining = allocation + in − out − spent", async () => {
    const s = await seedSeptember(db);
    await s.expense(s.dining.id, rs(13350));
    await s.expense(s.groceries.id, rs(17600));
    const res = await s.expense(s.groceries.id, rs(100), "2026-10-02"); // other month
    expect(res.category?.remaining).toBe(rs(30000) - rs(100));

    expect((await summary("2026-09", s.dining.id)).remaining).toBe(rs(-1350));
    await moveToCategory(db, {
      ym: "2026-09",
      toCategoryId: s.dining.id,
      source: { kind: "category", categoryId: s.groceries.id },
      amount: rs(1350),
      todayStr: "2026-09-29",
    });
    const dining = await summary("2026-09", s.dining.id);
    expect(dining.effectiveAllocation).toBe(rs(13350));
    expect(dining.remaining).toBe(0);
    expect((await summary("2026-09", s.groceries.id)).remaining).toBe(rs(30000 - 17600 - 1350));
  });

  it("returns the authoritative state on save", async () => {
    const s = await seedSeptember(db);
    const r = await s.expense(s.dining.id, rs(11000));
    expect(r.category?.state).toBe("amber");
    const r2 = await s.expense(s.dining.id, rs(2000));
    expect(r2.category?.state).toBe("red");
  });

  it("rejects an item from another category", async () => {
    const s = await seedSeptember(db);
    await expect(s.expense(s.groceries.id, rs(10), "2026-09-10", s.internet.id)).rejects.toThrow(/doesn't belong/);
  });
});

describe("covers", () => {
  it("cannot take a source below zero", async () => {
    const s = await seedSeptember(db);
    await s.expense(s.dining.id, rs(13000));
    await s.expense(s.groceries.id, rs(29500));
    await expect(
      moveToCategory(db, {
        ym: "2026-09",
        toCategoryId: s.dining.id,
        source: { kind: "category", categoryId: s.groceries.id },
        amount: rs(1000),
        todayStr: "2026-09-29",
      }),
    ).rejects.toThrow(/Only Rs 500/);
    await expect(
      moveToCategory(db, { ym: "2026-09", toCategoryId: s.dining.id, source: { kind: "savings" }, amount: rs(1000), todayStr: "2026-09-29" }),
    ).rejects.toThrow(/Savings only has Rs 0 free/);

    // Budgets are paid out of Savings: 65,000 in − 60,000 of September caps = 5,000 free.
    await adjustSavings(db, { direction: "in", amount: rs(65000), note: "Starting balance", todayStr: "2026-09-29" });
    expect(await getSavingsBalance(db, "2026-09")).toBe(rs(5000));
    await moveToCategory(db, { ym: "2026-09", toCategoryId: s.dining.id, source: { kind: "savings" }, amount: rs(1000), todayStr: "2026-09-29" });
    expect(await getSavingsBalance(db, "2026-09")).toBe(rs(4000));
    expect((await summary("2026-09", s.dining.id)).remaining).toBe(0);
  });
});

describe("monthly items", () => {
  it("unpaid → partial → paid → overpaid", async () => {
    const s = await seedSeptember(db);
    const status = async () => {
      const m = (await getMonth(db, "2026-09"))!;
      const [row] = await db
        .select()
        .from(monthlyItemStatus)
        .where(and(eq(monthlyItemStatus.monthId, m.id), eq(monthlyItemStatus.itemId, s.internet.id)));
      return row;
    };
    expect((await status()).status).toBe("unpaid");
    await s.expense(s.utilities.id, rs(2000), "2026-09-05", s.internet.id);
    expect(await status()).toMatchObject({ status: "partial", paid: rs(2000), expected: rs(3990) });
    await s.expense(s.utilities.id, rs(1990), "2026-09-20", s.internet.id);
    expect((await status()).status).toBe("paid");
    await s.expense(s.utilities.id, rs(450), "2026-09-21", s.internet.id);
    expect((await status()).paid).toBe(rs(4440));
  });
});

describe("new months", () => {
  it("copy allocations (not leftovers) from the previous month", async () => {
    const s = await seedSeptember(db);
    await s.expense(s.groceries.id, rs(5000));
    await ensureMonth(db, "2026-10");
    expect((await summary("2026-10", s.groceries.id)).allocation).toBe(rs(30000));
    expect((await summary("2026-10", s.groceries.id)).remaining).toBe(rs(30000));
  });
});

describe("month close", () => {
  it("is blocked until the month has ended, is categorised and nothing is negative", async () => {
    const s = await seedSeptember(db);
    const inbox = await s.expense(null, rs(780));
    await s.expense(s.dining.id, rs(13350));
    await s.expense(s.groceries.id, rs(17600));

    await expect(closeMonth(db, "2026-09", "2026-09-29")).rejects.toThrow(/can be closed from/);
    await expect(closeMonth(db, "2026-09", "2026-10-01")).rejects.toThrow(/Assign a category/);
    await assignCategory(db, inbox.expense.id, s.groceries.id);
    await expect(closeMonth(db, "2026-09", "2026-10-01")).rejects.toThrow(/Cover Dining/);
    await moveToCategory(db, {
      ym: "2026-09",
      toCategoryId: s.dining.id,
      source: { kind: "category", categoryId: s.groceries.id },
      amount: rs(1350),
      todayStr: "2026-09-30",
    });
    expect(await closeBlockers(db, "2026-09", "2026-09-30")).toMatchObject({ notEnded: false, uncategorized: 0, negative: [] });

    const { swept } = await closeMonth(db, "2026-09", "2026-09-30");
    // Groceries 30,000 − 17,600 − 780 − 1,350 + Utilities 18,000 + Dining 0
    expect(swept).toBe(rs(10270 + 18000));
    // Budgets came out of Savings and leftovers went back: net effect is minus what was spent.
    expect(await getSavingsBalance(db, "2026-09")).toBe(-rs(17600 + 780 + 13350));
    expect((await getMonth(db, "2026-09"))!.status).toBe("closed");
    const g = await summary("2026-09", s.groceries.id);
    expect(g.swept).toBe(rs(10270));
  });

  it("requires earlier months to be closed first", async () => {
    await seedSeptember(db);
    await ensureMonth(db, "2026-10");
    await expect(closeMonth(db, "2026-10", "2026-11-01")).rejects.toThrow(/Close September 2026 first/);
  });

  it("makes the month read-only, in the app and in the database", async () => {
    const s = await seedSeptember(db);
    const e = await s.expense(s.groceries.id, rs(100));
    await closeMonth(db, "2026-09", "2026-10-01");

    await expect(s.expense(s.groceries.id, rs(100), "2026-09-15")).rejects.toThrow(/closed and read-only/);
    await expect(
      updateExpense(db, e.expense.id, { spentOn: "2026-10-01", categoryId: s.groceries.id, itemId: null, amount: 1, note: null }),
    ).rejects.toThrow(/closed/);
    // Bypass the app: the triggers still refuse.
    await expect(db.update(expenses).set({ amount: 1 }).where(eq(expenses.id, e.expense.id))).rejects.toThrow();
    await expect(db.delete(expenses).where(eq(expenses.id, e.expense.id))).rejects.toThrow();
    await expect(db.update(categoryBudgets).set({ allocation: 1 })).rejects.toThrow();
    await expect(db.update(months).set({ defaultAlertPct: 5 })).rejects.toThrow();
    await expect(
      moveToCategory(db, { ym: "2026-09", toCategoryId: s.dining.id, source: { kind: "savings" }, amount: 1, todayStr: "2026-10-01" }),
    ).rejects.toThrow(/closed/);
  });
});

describe("setup", () => {
  it("saves everything at once and archives categories with history", async () => {
    const s = await seedSeptember(db);
    await s.expense(s.dining.id, rs(500));
    const extra = await createItem(db, { categoryId: s.groceries.id, name: "Keells", kind: "one_off", ym: "2026-09" });

    await saveSetup(db, {
      ym: "2026-09",
      defaultAlertPct: 15,
      currencySymbol: "Rs",
      currencyCode: "LKR",
      categories: [
        {
          id: s.groceries.id, name: "Food", color: "#1F5F5B", allocation: rs(25000), alertPct: 20, removed: false,
          items: [{ id: extra.id, name: "Keells", kind: "one_off", expectedAmount: null, defaultAmount: rs(2500), removed: false }],
        },
        { id: s.dining.id, name: "Dining", color: "#E08A3C", allocation: rs(12000), alertPct: null, removed: true, items: [] },
        {
          id: null, name: "Pharmacy", color: "#7A6FB0", allocation: rs(4000), alertPct: null, removed: false,
          items: [{ id: null, name: "Meds", kind: "monthly", expectedAmount: rs(1500), defaultAmount: null, removed: false }],
        },
      ],
    });

    const food = await summary("2026-09", s.groceries.id);
    expect(food).toMatchObject({ name: "Food", allocation: rs(25000), alertPct: 20 });
    // Dining had spending → archived, still visible with its history.
    const dining = await summary("2026-09", s.dining.id);
    expect(dining.archivedAt).not.toBeNull();
    expect(dining.spent).toBe(rs(500));
    // Utilities was left out of the payload entirely → untouched.
    expect((await summary("2026-09", s.utilities.id)).allocation).toBe(rs(18000));
  });

  it("deletes categories without history", async () => {
    const s = await seedSeptember(db);
    await removeCategory(db, s.dining.id);
    const m = (await getMonth(db, "2026-09"))!;
    const rows = await db.select().from(categoryBudgets).where(eq(categoryBudgets.monthId, m.id));
    expect(rows.map((r) => r.categoryId)).not.toContain(s.dining.id);
  });
});

describe("income", () => {
  const setup = (ym: string, incomesList: { source: string; amount: number }[], defaultIncome?: { source: string; amount: number | null }) =>
    saveSetup(db, { ym, defaultAlertPct: 10, currencySymbol: "Rs", currencyCode: "LKR", categories: [], incomes: incomesList, defaultIncome });
  const lines = async (ym: string) => {
    const m = (await getMonth(db, ym))!;
    return db.select().from(incomes).where(eq(incomes.monthId, m.id));
  };

  it("new months start with the default income only, nothing copied", async () => {
    await seedSeptember(db);
    await setup("2026-09", [{ source: "Insurance claim", amount: rs(300000) }], { source: "Salary", amount: rs(1089000) });
    await ensureMonth(db, "2026-10");
    expect((await lines("2026-10")).map((r) => [r.source, r.amount, r.status])).toEqual([["Salary", rs(1089000), "expected"]]);
  });

  it("counts in Savings only once received, and can be undone", async () => {
    await seedSeptember(db); // 60,000 of September budgets
    await setup("2026-09", [{ source: "Com", amount: rs(566000) }, { source: "Insurance", amount: rs(300000) }]);
    expect(await getSavingsBalance(db, "2026-09")).toBe(-rs(60000));

    const [com] = (await lines("2026-09")).filter((r) => r.source === "Com");
    await receiveIncome(db, com.id, "2026-09-29");
    expect(await getSavingsBalance(db, "2026-09")).toBe(rs(566000 - 60000));
    await expect(receiveIncome(db, com.id, "2026-09-29")).rejects.toThrow(/already/);

    // Saving Setup again replaces expected lines but keeps the received one.
    await setup("2026-09", [{ source: "Insurance", amount: rs(250000) }]);
    expect((await lines("2026-09")).map((r) => [r.source, r.status]).sort()).toEqual([["Com", "received"], ["Insurance", "expected"]]);

    await undoReceiveIncome(db, com.id);
    expect(await getSavingsBalance(db, "2026-09")).toBe(-rs(60000));
  });

  it("still expected at month close moves to the next month; received stays and is locked", async () => {
    await seedSeptember(db);
    await setup("2026-09", [{ source: "Com", amount: rs(566000) }, { source: "Insurance", amount: rs(300000) }]);
    const [com] = (await lines("2026-09")).filter((r) => r.source === "Com");
    await receiveIncome(db, com.id, "2026-09-29");

    const res = await closeMonth(db, "2026-09", "2026-10-01");
    expect(res.movedIncome).toBe(1);
    expect((await lines("2026-09")).map((r) => r.source)).toEqual(["Com"]);
    expect((await lines("2026-10")).map((r) => r.source)).toContain("Insurance");
    await expect(undoReceiveIncome(db, com.id)).rejects.toThrow(/closed/);
    await expect(db.delete(incomes).where(eq(incomes.id, com.id))).rejects.toThrow();
  });
});

describe("monthly items and caps", () => {
  it("are not due in a month where their category has no cap", async () => {
    const s = await seedSeptember(db);
    const due = async () => {
      const m = (await getMonth(db, "2026-09"))!;
      return (await db.select().from(monthlyItemStatus).where(eq(monthlyItemStatus.monthId, m.id))).map((r) => r.name);
    };
    expect(await due()).toContain("Internet");
    await saveSetup(db, {
      ym: "2026-09", defaultAlertPct: 10, currencySymbol: "Rs", currencyCode: "LKR",
      categories: [{ id: s.utilities.id, name: "Utilities", color: "#00897B", allocation: 0, alertPct: null, removed: false,
        items: [{ id: s.internet.id, name: "Internet", kind: "monthly", expectedAmount: rs(3990), defaultAmount: null, removed: false }] }],
    });
    expect(await due()).not.toContain("Internet");
    // Paying it anyway brings it back, so the payment is never hidden.
    await s.expense(s.utilities.id, rs(100), "2026-09-12", s.internet.id);
    expect(await due()).toContain("Internet");
  });
});

describe("items across months", () => {
  it("monthly items carry into every month; one-offs stay in the month they were added for", async () => {
    const s = await seedSeptember(db);
    await createItem(db, { categoryId: s.groceries.id, name: "Dress", kind: "one_off", ym: "2026-09" });
    const sep = (await getMonth(db, "2026-09"))!;
    const oct = await ensureMonth(db, "2026-10");
    const names = async (monthId: string) => (await itemsForMonth(db, monthId)).map((i) => i.name).sort();

    expect(await names(sep.id)).toEqual(["Dress", "Internet"]);
    expect(await names(oct.id)).toEqual(["Internet"]);
    // Categories and caps still carry over.
    expect((await summary("2026-10", s.groceries.id)).allocation).toBe(rs(30000));
    // The same one-off name can be used again in a later month.
    await createItem(db, { categoryId: s.groceries.id, name: "Dress", kind: "one_off", ym: "2026-10" });
    expect(await names(oct.id)).toEqual(["Dress", "Internet"]);
  });

  it("switching an item to monthly in Setup makes it carry over", async () => {
    const s = await seedSeptember(db);
    const pads = await createItem(db, { categoryId: s.groceries.id, name: "Pads", kind: "one_off", ym: "2026-09" });
    await saveSetup(db, {
      ym: "2026-09", defaultAlertPct: 10, currencySymbol: "Rs", currencyCode: "LKR",
      categories: [{ id: s.groceries.id, name: "Groceries", color: "#00897B", allocation: rs(30000), alertPct: null, removed: false,
        items: [{ id: pads.id, name: "Pads", kind: "monthly", expectedAmount: rs(10000), defaultAmount: null, removed: false }] }],
    });
    const oct = await ensureMonth(db, "2026-10");
    expect((await itemsForMonth(db, oct.id)).map((i) => i.name)).toContain("Pads");
  });
});
