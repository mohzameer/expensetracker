import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accountEntries, capturedMessages, categoryBudgets, categoryMonthSummary, expenses, incomes, items, monthlyItemStatus, months, settings } from "@/db/schema";
import { dismissMessage, getPendingMessages, ingestMessage, logMessage, logTransfer, restoreMessage, senderAllowed, setMessageSenders } from "@/server/domain/messages";
import { closeBlockers, closeMonth, ensureMonth, getMonth, monthOfDate } from "@/server/domain/months";
import { getSavingsBalance, moveToCategory } from "@/server/domain/transfers";
import { receiveIncome, undoReceiveIncome } from "@/server/domain/incomes";
import { assignCategory, createExpense, updateExpense } from "@/server/domain/expenses";
import { addAccountAdjustment, createAccount, deleteAccountAdjustment, getAccounts, setAccountBalance, transferBetweenAccounts } from "@/server/domain/accounts";
import { createItem, itemsForMonth, removeCategory, removeItem, saveSetup, setChartHiddenCategories, setItemComplete } from "@/server/domain/catalog";
import { getDashboard, getDayView, getMonthlyItems, getUnplanned } from "@/server/queries";
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
    // Savings = money in accounts − what's still unspent in budgets (500 Groceries + 18,000 Utilities).
    await createAccount(db, { name: "ComBank", opening: rs(23500), todayStr: "2026-09-29" });
    expect(await getSavingsBalance(db, "2026-09")).toBe(rs(5000));

    // "Raise this month's cap": Dining grows to fit what was spent, for this month only.
    // It is never blocked and doesn't change savings — that cash was already spent.
    await moveToCategory(db, { ym: "2026-09", toCategoryId: s.dining.id, source: { kind: "savings" }, amount: rs(1000), todayStr: "2026-09-29" });
    const dining = await summary("2026-09", s.dining.id);
    expect(dining).toMatchObject({ allocation: rs(12000), effectiveAllocation: rs(13000), remaining: 0 });
    expect(await getSavingsBalance(db, "2026-09")).toBe(rs(5000));
    await ensureMonth(db, "2026-10");
    expect((await summary("2026-10", s.dining.id)).effectiveAllocation).toBe(rs(12000)); // next month: normal cap

    // Topping up a budget that still has room sets more money aside, and is limited to what's left as savings.
    await moveToCategory(db, { ym: "2026-09", toCategoryId: s.groceries.id, source: { kind: "savings" }, amount: rs(1000), todayStr: "2026-09-29", reason: "manual" });
    expect(await getSavingsBalance(db, "2026-09")).toBe(rs(4000));
    await expect(
      moveToCategory(db, { ym: "2026-09", toCategoryId: s.groceries.id, source: { kind: "savings" }, amount: rs(9000), todayStr: "2026-09-29", reason: "manual" }),
    ).rejects.toThrow(/Only Rs 4,000 is left as savings/);
  });
});

describe("accounts", () => {
  it("balance = opening + income received − expenses paid from it; corrections and transfers", async () => {
    const s = await seedSeptember(db);
    const com = await createAccount(db, { name: "ComBank", opening: rs(183282), todayStr: "2026-09-29" });
    const amana = await createAccount(db, { name: "Amana", opening: rs(600286), todayStr: "2026-09-29" });
    const bal = async () => Object.fromEntries((await getAccounts(db)).map((a) => [a.name, a.balance]));

    // Legacy expense (no account) doesn't move balances; a new one does.
    await s.expense(s.groceries.id, rs(1000));
    await createExpense(db, { spentOn: "2026-09-29", categoryId: s.groceries.id, itemId: null, amount: rs(2850), note: null, accountId: com.id });
    expect(await bal()).toEqual({ ComBank: rs(183282 - 2850), Amana: rs(600286) });

    await transferBetweenAccounts(db, { fromId: amana.id, toId: com.id, amount: rs(100000), todayStr: "2026-09-29" });
    await expect(transferBetweenAccounts(db, { fromId: com.id, toId: amana.id, amount: rs(10_000_000), todayStr: "2026-09-29" })).rejects.toThrow(
      /only has/,
    );
    await setAccountBalance(db, { accountId: amana.id, actual: rs(500000), todayStr: "2026-09-30" });
    expect(await bal()).toEqual({ ComBank: rs(183282 - 2850 + 100000), Amana: rs(500000) });

    // Income lands in its account when received.
    await saveSetup(db, {
      ym: "2026-09", defaultAlertPct: 10, currencySymbol: "Rs", currencyCode: "LKR", categories: [],
      incomes: [{ source: "Insurance", amount: rs(300000), accountId: com.id }],
    });
    const m = (await getMonth(db, "2026-09"))!;
    const [ins] = await db.select().from(incomes).where(eq(incomes.monthId, m.id));
    await receiveIncome(db, ins.id, "2026-09-30");
    expect((await bal()).ComBank).toBe(rs(183282 - 2850 + 100000 + 300000));
    await undoReceiveIncome(db, ins.id);
    expect((await bal()).ComBank).toBe(rs(183282 - 2850 + 100000));
  });

  it("money that came back: an expense edited to zero stays, and gives back budget and balance", async () => {
    const s = await seedSeptember(db);
    const com = await createAccount(db, { name: "ComBank", opening: rs(50000), todayStr: "2026-09-29" });
    const lent = { spentOn: "2026-09-29", categoryId: s.groceries.id, itemId: null, amount: rs(5000), note: "Lent to Sam", accountId: com.id };
    const { expense } = await createExpense(db, lent);
    expect((await getAccounts(db))[0].balance).toBe(rs(45000));

    const res = await updateExpense(db, expense.id, { ...lent, amount: 0, note: "Lent to Sam · Returned 5,000.00" });
    expect(res.expense.amount).toBe(0);
    expect(res.category?.remaining).toBe(rs(30000));
    expect((await getAccounts(db))[0].balance).toBe(rs(50000));
    await expect(db.update(expenses).set({ amount: -1 }).where(eq(expenses.id, expense.id))).rejects.toThrow();
  });

  it("income needs an account before it can be received", async () => {
    await seedSeptember(db);
    await saveSetup(db, {
      ym: "2026-09", defaultAlertPct: 10, currencySymbol: "Rs", currencyCode: "LKR", categories: [],
      incomes: [{ source: "Bonus", amount: rs(1000), accountId: null }],
    });
    const m = (await getMonth(db, "2026-09"))!;
    const [line] = await db.select().from(incomes).where(eq(incomes.monthId, m.id));
    await expect(receiveIncome(db, line.id, "2026-09-30")).rejects.toThrow(/Choose which account/);
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

describe("completing a monthly item under its amount", () => {
  it("stops the rest being due and leaves the cap alone", async () => {
    const s = await seedSeptember(db);
    await s.expense(s.utilities.id, rs(2000), "2026-09-05", s.internet.id); // Internet 3,990 planned
    const internet = async () => (await getMonthlyItems(db, await getMonth(db, "2026-09"))).find((m) => m.itemId === s.internet.id)!;
    expect(await internet()).toMatchObject({ status: "partial", completed: false });

    await setItemComplete(db, { itemId: s.internet.id, ym: "2026-09", complete: true });
    expect(await internet()).toMatchObject({ status: "paid", completed: true, paid: rs(2000), expected: rs(3990) });
    // Only Power is still due; the 1,990 Internet didn't need stays free in Utilities.
    expect(await summary("2026-09", s.utilities.id)).toMatchObject({ allocation: rs(18000), remaining: rs(16000) });
    expect((await getUnplanned(db, "2026-09")).find((r) => r.categoryId === s.utilities.id)).toMatchObject({ unplanned: 0, due: rs(14010) });

    // That freed room can go to something unplanned without going over the cap.
    await s.expense(s.utilities.id, rs(1500));
    let d = await getDashboard(db, "2026-09");
    expect(d.short.map((x) => x.name)).not.toContain("Utilities");
    expect(d.owed.map((o) => o.name)).toEqual(expect.not.arrayContaining(["Internet"]));
    expect(d.completedShort.map((o) => o.name)).toEqual(["Internet"]);

    await setItemComplete(db, { itemId: s.internet.id, ym: "2026-09", complete: false });
    expect(await internet()).toMatchObject({ status: "partial", completed: false });
    d = await getDashboard(db, "2026-09");
    expect(d.completedShort).toEqual([]);
  });

  it("is for one month only and for monthly items only", async () => {
    const s = await seedSeptember(db);
    await setItemComplete(db, { itemId: s.power.id, ym: "2026-09", complete: true });
    await ensureMonth(db, "2026-10");
    const oct = await getMonthlyItems(db, await getMonth(db, "2026-10"));
    expect(oct.find((m) => m.itemId === s.power.id)).toMatchObject({ status: "unpaid", completed: false });

    const snack = await createItem(db, { categoryId: s.groceries.id, name: "Snacks", kind: "one_off", defaultAmount: rs(1000), ym: "2026-09" });
    await expect(setItemComplete(db, { itemId: snack.id, ym: "2026-09", complete: true })).rejects.toThrow(/Only monthly items/);
  });
});

describe("unplanned spending", () => {
  it("counts what items were paid beyond their plan plus spending on nothing planned", async () => {
    const s = await seedSeptember(db);
    await s.expense(s.utilities.id, rs(10000), "2026-09-05", s.internet.id); // Internet planned 3,990 → 6,010 over
    await s.expense(s.dining.id, rs(500)); // no item → all unplanned
    const snack = await createItem(db, { categoryId: s.groceries.id, name: "Snacks", kind: "one_off", defaultAmount: rs(1000), ym: "2026-09" });
    await s.expense(s.groceries.id, rs(1500), "2026-09-10", snack.id); // one-off planned 1,000 → 500 over
    await s.expense(s.groceries.id, rs(200), "2026-10-02"); // next month

    const rows = await getUnplanned(db, "2026-09");
    const of = (categoryId: string) => rows.find((r) => r.categoryId === categoryId);
    expect(of(s.utilities.id)).toMatchObject({ unplanned: rs(6010), due: rs(14010) });
    expect(of(s.dining.id)).toMatchObject({ unplanned: rs(500), due: rs(12000) });
    expect(of(s.groceries.id)).toMatchObject({ unplanned: rs(500), due: rs(30000) });
    expect(rows.every((r) => r.yearMonth === "2026-09")).toBe(true);

    // Utilities has 8,000 left but Power still needs 14,010: 6,010 over budget once it's paid.
    let d = await getDashboard(db, "2026-09");
    expect(d.totals).toMatchObject({ unplanned: rs(7010), short: rs(6010 + 500 + 500) });
    expect(d.short[0]).toMatchObject({ name: "Utilities", amount: rs(6010) });

    // A cover makes room for it: still unplanned, no longer short.
    await moveToCategory(db, { ym: "2026-09", toCategoryId: s.utilities.id, source: { kind: "savings" }, amount: rs(6010), todayStr: "2026-09-29" });
    d = await getDashboard(db, "2026-09");
    expect(d.totals).toMatchObject({ unplanned: rs(7010), short: rs(1000) });
    expect(d.short.map((x) => x.name)).not.toContain("Utilities");

    d = await getDashboard(db, "2026-10");
    expect(d.unplannedMonths.map((m) => [m.ym, m.total])).toEqual([["2026-09", rs(7010)], ["2026-10", rs(200)]]);
  });
});

describe("caps are the total of a category's items", () => {
  const cap = async (ym: string, categoryId: string) => (await summary(ym, categoryId)).allocation;

  it("a new month starts at the sum of the monthly items, not last month's leftovers", async () => {
    const s = await seedSeptember(db);
    await s.expense(s.groceries.id, rs(5000));
    await ensureMonth(db, "2026-10");
    expect(await cap("2026-10", s.utilities.id)).toBe(rs(3990 + 14010));
    expect((await summary("2026-10", s.groceries.id)).remaining).toBe(rs(30000));
  });

  it("a one-off raises the cap of its own month only", async () => {
    const s = await seedSeptember(db);
    await ensureMonth(db, "2026-10");
    await createItem(db, { categoryId: s.groceries.id, name: "Dress", kind: "one_off", defaultAmount: rs(4500), ym: "2026-09" });
    await createItem(db, { categoryId: s.groceries.id, name: "Gift", kind: "one_off", ym: "2026-09" }); // no planned amount → adds nothing
    expect(await cap("2026-09", s.groceries.id)).toBe(rs(34500));
    expect(await cap("2026-10", s.groceries.id)).toBe(rs(30000));
    // A month created later doesn't pick it up either.
    await ensureMonth(db, "2026-11");
    expect(await cap("2026-11", s.groceries.id)).toBe(rs(30000));
  });

  it("changing a monthly amount moves the cap in open months and leaves closed ones alone", async () => {
    const s = await seedSeptember(db);
    await closeMonth(db, "2026-09", "2026-10-01");
    await ensureMonth(db, "2026-10");
    await ensureMonth(db, "2026-11");
    await saveSetup(db, {
      ym: "2026-10", defaultAlertPct: 10, currencySymbol: "Rs", currencyCode: "LKR",
      categories: [{ id: s.utilities.id, name: "Utilities", color: "#00897B", alertPct: null, removed: false,
        items: [{ id: s.internet.id, name: "Internet", kind: "monthly", expectedAmount: rs(21000), defaultAmount: null, removed: false }] }],
    });
    expect(await cap("2026-09", s.utilities.id)).toBe(rs(18000));
    expect(await cap("2026-10", s.utilities.id)).toBe(rs(21000 + 14010));
    expect(await cap("2026-11", s.utilities.id)).toBe(rs(21000 + 14010));
  });

  it("removing an item lowers the cap, and a cover sits on top of it", async () => {
    const s = await seedSeptember(db);
    await moveToCategory(db, { ym: "2026-09", toCategoryId: s.utilities.id, source: { kind: "savings" }, amount: rs(1000), reason: "cover", todayStr: "2026-09-10" });
    await saveSetup(db, {
      ym: "2026-09", defaultAlertPct: 10, currencySymbol: "Rs", currencyCode: "LKR",
      categories: [{ id: s.utilities.id, name: "Utilities", color: "#00897B", alertPct: null, removed: false,
        items: [{ id: s.power.id, name: "Power", kind: "monthly", expectedAmount: rs(14010), defaultAmount: null, removed: true }] }],
    });
    const u = await summary("2026-09", s.utilities.id);
    expect(u.allocation).toBe(rs(3990));
    expect(u.effectiveAllocation).toBe(rs(4990));
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
    // Once closed, nothing in September is set aside any more (no accounts in this test).
    expect(await getSavingsBalance(db, "2026-09")).toBe(0);
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
          id: s.groceries.id, name: "Food", color: "#1F5F5B", alertPct: 20, removed: false,
          items: [{ id: extra.id, name: "Keells", kind: "one_off", expectedAmount: null, defaultAmount: rs(2500), removed: false }],
        },
        { id: s.dining.id, name: "Dining", color: "#E08A3C", alertPct: null, removed: true, items: [] },
        {
          id: null, name: "Pharmacy", color: "#7A6FB0", alertPct: null, removed: false,
          items: [{ id: null, name: "Meds", kind: "monthly", expectedAmount: rs(1500), defaultAmount: null, removed: false }],
        },
      ],
    });

    const food = await summary("2026-09", s.groceries.id);
    // Cap = its monthly item (30,000) + the one-off's planned amount.
    expect(food).toMatchObject({ name: "Food", allocation: rs(32500), alertPct: 20 });
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
  // Income lands in an account; these tests use one empty ComBank account.
  const setup = async (ym: string, incomesList: { source: string; amount: number }[]) => {
    const acct = (await getAccounts(db))[0] ?? (await createAccount(db, { name: "ComBank", opening: 0, todayStr: "2026-09-01" }));
    return saveSetup(db, {
      ym, defaultAlertPct: 10, currencySymbol: "Rs", currencyCode: "LKR", categories: [],
      incomes: incomesList.map((i) => ({ ...i, accountId: acct.id })),
    });
  };
  const lines = async (ym: string) => {
    const m = (await getMonth(db, ym))!;
    return db.select().from(incomes).where(eq(incomes.monthId, m.id));
  };

  it("new months start with no income lines, nothing copied", async () => {
    await seedSeptember(db);
    await setup("2026-09", [{ source: "Insurance claim", amount: rs(300000) }]);
    await db.update(settings).set({ defaultIncomeAmount: rs(1089000) }).where(eq(settings.id, 1));
    await ensureMonth(db, "2026-10");
    expect(await lines("2026-10")).toEqual([]);
  });

  it("counts toward free money only once received, and can be undone", async () => {
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

describe("skipping a monthly item for one month", () => {
  const cap = async (ym: string, categoryId: string) => (await summary(ym, categoryId)).allocation;
  const dueNames = async (ym: string) => (await getMonthlyItems(db, (await getMonth(db, ym))!)).map((d) => d.name);
  const setup = (s: Awaited<ReturnType<typeof seedSeptember>>, ym: string, skipped: boolean) =>
    saveSetup(db, {
      ym, defaultAlertPct: 10, currencySymbol: "Rs", currencyCode: "LKR",
      categories: [{ id: s.utilities.id, name: "Utilities", color: "#00897B", alertPct: null, removed: false,
        items: [{ id: s.internet.id, name: "Internet", kind: "monthly", expectedAmount: rs(3990), defaultAmount: null, skipped, removed: false }] }],
    });

  it("takes it out of that month's cap and Due list only, and can be undone", async () => {
    const s = await seedSeptember(db);
    await ensureMonth(db, "2026-10");
    await setup(s, "2026-09", true);
    expect(await cap("2026-09", s.utilities.id)).toBe(rs(14010));
    expect(await dueNames("2026-09")).not.toContain("Internet");
    // October is untouched, and so is a month created afterwards.
    expect(await cap("2026-10", s.utilities.id)).toBe(rs(18000));
    expect(await dueNames("2026-10")).toContain("Internet");
    await ensureMonth(db, "2026-11");
    expect(await cap("2026-11", s.utilities.id)).toBe(rs(18000));

    await setup(s, "2026-09", false);
    expect(await cap("2026-09", s.utilities.id)).toBe(rs(18000));
    expect(await dueNames("2026-09")).toContain("Internet");
  });

  it("still shows a payment made on a skipped item", async () => {
    const s = await seedSeptember(db);
    await setup(s, "2026-09", true);
    await s.expense(s.utilities.id, rs(500), "2026-09-12", s.internet.id);
    expect(await dueNames("2026-09")).toContain("Internet");
    expect((await summary("2026-09", s.utilities.id)).spent).toBe(rs(500));
  });

  it("can be set on an item created in the same save", async () => {
    const s = await seedSeptember(db);
    await saveSetup(db, {
      ym: "2026-09", defaultAlertPct: 10, currencySymbol: "Rs", currencyCode: "LKR",
      categories: [{ id: s.dining.id, name: "Dining", color: "#00897B", alertPct: null, removed: false,
        items: [{ id: null, name: "Club", kind: "monthly", expectedAmount: rs(2000), defaultAmount: null, skipped: true, removed: false }] }],
    });
    expect(await cap("2026-09", s.dining.id)).toBe(rs(12000));
    await ensureMonth(db, "2026-10");
    expect(await cap("2026-10", s.dining.id)).toBe(rs(14000));
  });
});

describe("how long a monthly item runs", () => {
  const cap = async (ym: string, categoryId: string) => (await summary(ym, categoryId)).allocation;
  const dueNames = async (ym: string) => (await getMonthlyItems(db, (await getMonth(db, ym))!)).map((d) => d.name);
  const offered = async (ym: string) => (await itemsForMonth(db, (await getMonth(db, ym))!.id)).map((i) => i.name);
  const internet = (s: Awaited<ReturnType<typeof seedSeptember>>, extra: Record<string, unknown>) =>
    ({ id: s.internet.id, name: "Internet", kind: "monthly" as const, expectedAmount: rs(3990), defaultAmount: null, removed: false, ...extra });
  const setup = (s: Awaited<ReturnType<typeof seedSeptember>>, ym: string, item: ReturnType<typeof internet>) =>
    saveSetup(db, {
      ym, defaultAlertPct: 10, currencySymbol: "Rs", currencyCode: "LKR",
      categories: [{ id: s.utilities.id, name: "Utilities", color: "#00897B", alertPct: null, removed: false, items: [item] }],
    });

  it("counts for its months only: caps, Due list and the items offered", async () => {
    const s = await seedSeptember(db);
    for (const ym of ["2026-10", "2026-11", "2026-12"]) await ensureMonth(db, ym);
    await setup(s, "2026-09", internet(s, { endYm: "2026-11" })); // 3 months from September
    for (const ym of ["2026-09", "2026-10", "2026-11"]) {
      expect(await cap(ym, s.utilities.id)).toBe(rs(18000));
      expect(await offered(ym)).toContain("Internet");
    }
    expect(await dueNames("2026-11")).toContain("Internet");
    expect(await cap("2026-12", s.utilities.id)).toBe(rs(14010));
    expect(await dueNames("2026-12")).not.toContain("Internet");
    expect(await offered("2026-12")).not.toContain("Internet");
    // A month created afterwards leaves it out too.
    await ensureMonth(db, "2027-01");
    expect(await cap("2027-01", s.utilities.id)).toBe(rs(14010));
  });

  it("stop after this month keeps this month and drops the next; until I stop brings it back", async () => {
    const s = await seedSeptember(db);
    await ensureMonth(db, "2026-10");
    await setup(s, "2026-09", internet(s, { endYm: "2026-09" }));
    expect(await cap("2026-09", s.utilities.id)).toBe(rs(18000));
    expect(await dueNames("2026-09")).toContain("Internet");
    expect(await cap("2026-10", s.utilities.id)).toBe(rs(14010));

    await setup(s, "2026-09", internet(s, { endYm: null }));
    expect(await cap("2026-10", s.utilities.id)).toBe(rs(18000));
    // Leaving the field out of a save changes nothing.
    await setup(s, "2026-09", internet(s, { endYm: "2026-09" }));
    await setup(s, "2026-09", internet(s, {}));
    expect(await cap("2026-10", s.utilities.id)).toBe(rs(14010));
  });

  it("can't stop before the month being saved, and a one-off never has an end", async () => {
    const s = await seedSeptember(db);
    await ensureMonth(db, "2026-10");
    await expect(setup(s, "2026-10", internet(s, { endYm: "2026-09" }))).rejects.toThrow(/can't stop before October/);
    await setup(s, "2026-09", internet(s, { endYm: "2026-11" }));
    await setup(s, "2026-09", { ...internet(s, { endYm: "2026-11" }), kind: "one_off" as never, expectedAmount: null, defaultAmount: rs(3990) } as never);
    const [row] = await db.select().from(items).where(eq(items.id, s.internet.id));
    expect([row.kind, row.endYm]).toEqual(["one_off", null]);
  });

  it("leaves closed months as they closed", async () => {
    const s = await seedSeptember(db);
    await closeMonth(db, "2026-09", "2026-10-01");
    await ensureMonth(db, "2026-10");
    await ensureMonth(db, "2026-11");
    await setup(s, "2026-10", internet(s, { endYm: "2026-10" }));
    expect(await cap("2026-09", s.utilities.id)).toBe(rs(18000));
    expect(await cap("2026-11", s.utilities.id)).toBe(rs(14010));
  });

  it("adding an ended item's name again restarts it, without filling the months in between", async () => {
    const s = await seedSeptember(db);
    for (const ym of ["2026-10", "2026-11"]) await ensureMonth(db, ym);
    await setup(s, "2026-09", internet(s, { endYm: "2026-09" }));
    // November: the same name is added as a new monthly item, for 2 months.
    await saveSetup(db, {
      ym: "2026-11", defaultAlertPct: 10, currencySymbol: "Rs", currencyCode: "LKR",
      categories: [{ id: s.utilities.id, name: "Utilities", color: "#00897B", alertPct: null, removed: false,
        items: [{ id: null, name: "internet", kind: "monthly", expectedAmount: rs(5000), defaultAmount: null, endYm: "2026-12", removed: false }] }],
    });
    const rows = await db.select().from(items).where(eq(items.categoryId, s.utilities.id));
    expect(rows.filter((r) => r.name.toLowerCase() === "internet")).toHaveLength(1);
    expect(await cap("2026-10", s.utilities.id)).toBe(rs(14010)); // the gap stays empty
    expect(await cap("2026-11", s.utilities.id)).toBe(rs(14010 + 5000));
    // From the expense sheet it restarts as "until I stop".
    await setup(s, "2026-11", { ...internet(s, { endYm: "2026-11" }), expectedAmount: rs(5000) });
    await ensureMonth(db, "2027-01");
    const again = await createItem(db, { categoryId: s.utilities.id, name: "Internet", kind: "monthly", expectedAmount: rs(6000), ym: "2027-01" });
    expect([again.id, again.endYm]).toEqual([s.internet.id, null]);
    expect(await cap("2027-01", s.utilities.id)).toBe(rs(14010 + 6000));
  });
});

describe("items across months", () => {
  it("monthly items carry into every month; one-offs stay in the month they were added for", async () => {
    const s = await seedSeptember(db);
    await createItem(db, { categoryId: s.groceries.id, name: "Dress", kind: "one_off", ym: "2026-09" });
    const sep = (await getMonth(db, "2026-09"))!;
    const oct = await ensureMonth(db, "2026-10");
    const names = async (monthId: string) => (await itemsForMonth(db, monthId)).map((i) => i.name).sort();

    const carried = ["Internet", "Meals", "Power", "Shop"];
    expect(await names(sep.id)).toEqual(["Dress", ...carried]);
    expect(await names(oct.id)).toEqual(carried);
    // The same one-off name can be used again in a later month.
    await createItem(db, { categoryId: s.groceries.id, name: "Dress", kind: "one_off", ym: "2026-10" });
    expect(await names(oct.id)).toEqual(["Dress", ...carried]);
  });

  it("switching an item to monthly in Setup makes it carry over", async () => {
    const s = await seedSeptember(db);
    const pads = await createItem(db, { categoryId: s.groceries.id, name: "Pads", kind: "one_off", ym: "2026-09" });
    await saveSetup(db, {
      ym: "2026-09", defaultAlertPct: 10, currencySymbol: "Rs", currencyCode: "LKR",
      categories: [{ id: s.groceries.id, name: "Groceries", color: "#00897B", alertPct: null, removed: false,
        items: [{ id: pads.id, name: "Pads", kind: "monthly", expectedAmount: rs(10000), defaultAmount: null, removed: false }] }],
    });
    const oct = await ensureMonth(db, "2026-10");
    expect((await itemsForMonth(db, oct.id)).map((i) => i.name)).toContain("Pads");
  });
});

describe("as-needed items", () => {
  const cap = async (ym: string, categoryId: string) => (await summary(ym, categoryId)).allocation;
  const dueNames = async (ym: string) => (await getMonthlyItems(db, (await getMonth(db, ym))!)).map((d) => d.name);
  const offered = async (ym: string) => (await itemsForMonth(db, (await getMonth(db, ym))!.id)).map((i) => i.name);

  it("are offered every month but add nothing to the cap and are never due", async () => {
    const s = await seedSeptember(db);
    const doctor = await createItem(db, { categoryId: s.groceries.id, name: "Doctor", kind: "as_needed", defaultAmount: rs(2500), ym: "2026-09" });
    expect([doctor.monthId, doctor.expectedAmount, doctor.defaultAmount]).toEqual([null, null, rs(2500)]);
    await ensureMonth(db, "2026-10");
    for (const ym of ["2026-09", "2026-10"]) {
      expect(await cap(ym, s.groceries.id)).toBe(rs(30000));
      expect(await offered(ym)).toContain("Doctor");
      expect(await dueNames(ym)).not.toContain("Doctor");
    }
    // Spending on it is unplanned: nothing was planned for it.
    await s.expense(s.groceries.id, rs(3200), "2026-09-12", doctor.id);
    const [row] = (await getUnplanned(db, "2026-09")).filter((r) => r.categoryId === s.groceries.id);
    expect(row).toMatchObject({ unplanned: rs(3200), due: rs(30000) });
  });

  it("switching a monthly item to as needed in Setup drops it from the cap and clears its skip and end", async () => {
    const s = await seedSeptember(db);
    await ensureMonth(db, "2026-10");
    const save = (item: Record<string, unknown>) =>
      saveSetup(db, {
        ym: "2026-09", defaultAlertPct: 10, currencySymbol: "Rs", currencyCode: "LKR",
        categories: [{ id: s.utilities.id, name: "Utilities", color: "#00897B", alertPct: null, removed: false,
          items: [{ id: s.internet.id, name: "Internet", removed: false, ...item } as never] }],
      });
    await save({ kind: "monthly", expectedAmount: rs(3990), defaultAmount: null, skipped: true, endYm: "2026-10" });
    await save({ kind: "as_needed", expectedAmount: null, defaultAmount: rs(4000), skipped: true, endYm: "2026-10" });
    const [row] = await db.select().from(items).where(eq(items.id, s.internet.id));
    expect([row.kind, row.monthId, row.expectedAmount, row.defaultAmount, row.endYm]).toEqual(["as_needed", null, null, rs(4000), null]);
    expect(await cap("2026-09", s.utilities.id)).toBe(rs(14010));
    expect(await cap("2026-10", s.utilities.id)).toBe(rs(14010));
    expect(await offered("2026-10")).toContain("Internet");
    expect(await dueNames("2026-09")).not.toContain("Internet");
  });
});

describe("warn when paid twice in a month", () => {
  it("is saved from Setup, kept when left out, and the day view loads that item's payments", async () => {
    const s = await seedSeptember(db);
    const save = (extra: Record<string, unknown>) =>
      saveSetup(db, {
        ym: "2026-09", defaultAlertPct: 10, currencySymbol: "Rs", currencyCode: "LKR",
        categories: [{ id: s.utilities.id, name: "Utilities", color: "#00897B", alertPct: null, removed: false,
          items: [{ id: s.internet.id, name: "Internet", kind: "monthly", expectedAmount: rs(3990), defaultAmount: null, removed: false, ...extra }] }],
      });
    await save({ warnTwice: true });
    await save({});
    const [row] = await db.select().from(items).where(eq(items.id, s.internet.id));
    expect(row.warnTwice).toBe(true);

    await s.expense(s.utilities.id, rs(3990), "2026-09-03", s.internet.id);
    await s.expense(s.utilities.id, rs(14010), "2026-09-04", s.power.id); // Power doesn't warn
    const day = await getDayView(db, "2026-09-20");
    expect(day.warnPayments.map((p) => [p.itemId, p.spentOn, p.amount])).toEqual([[s.internet.id, "2026-09-03", rs(3990)]]);
    expect(day.catalog.items.find((i) => i.id === s.internet.id)?.warnTwice).toBe(true);
  });
});

describe("pay-cycle months (start on the 25th)", () => {
  const startOn = (day: number) => db.update(settings).set({ periodStartDay: day }).where(eq(settings.id, 1));

  it("September runs 25 Sep → 24 Oct and October follows on", async () => {
    await startOn(25);
    const sep = await ensureMonth(db, "2026-09");
    const oct = await ensureMonth(db, "2026-10");
    expect([sep.startsOn, sep.endsOn]).toEqual(["2026-09-25", "2026-10-25"]);
    expect([oct.startsOn, oct.endsOn]).toEqual(["2026-10-25", "2026-11-25"]);
    expect(await monthOfDate(db, "2026-09-24")).toBe("2026-08");
    expect(await monthOfDate(db, "2026-10-10")).toBe("2026-09");
    expect(await monthOfDate(db, "2026-10-25")).toBe("2026-10");
  });

  it("counts spending by the cycle, including monthly bills", async () => {
    await startOn(25);
    const s = await seedSeptember(db);
    await s.expense(s.groceries.id, rs(1000), "2026-10-10"); // still September's cycle
    await s.expense(s.groceries.id, rs(500), "2026-10-26"); // October's
    await s.expense(s.utilities.id, rs(3990), "2026-10-05", s.internet.id);
    expect((await summary("2026-09", s.groceries.id)).spent).toBe(rs(1000));
    expect((await summary("2026-10", s.groceries.id)).spent).toBe(rs(500));
    const m = (await getMonth(db, "2026-09"))!;
    const [internet] = await db
      .select()
      .from(monthlyItemStatus)
      .where(and(eq(monthlyItemStatus.monthId, m.id), eq(monthlyItemStatus.itemId, s.internet.id)));
    expect(internet.status).toBe("paid");
  });

  it("closes on the cycle's last day and then locks those dates only", async () => {
    await startOn(25);
    const s = await seedSeptember(db);
    await s.expense(s.groceries.id, rs(100), "2026-10-01");
    await expect(closeMonth(db, "2026-09", "2026-10-23")).rejects.toThrow(/can be closed from Sat 24 Oct/);
    await closeMonth(db, "2026-09", "2026-10-24");
    await expect(s.expense(s.groceries.id, rs(100), "2026-10-20")).rejects.toThrow(/closed/);
    await expect(db.insert(expenses).values({ spentOn: "2026-10-20", amount: 1 })).rejects.toThrow();
    const late = await s.expense(s.groceries.id, rs(100), "2026-10-26"); // October is open
    expect(late.expense.id).toBeTruthy();
  });

  it("changing the start day keeps months contiguous", async () => {
    await startOn(25);
    await ensureMonth(db, "2026-09");
    await ensureMonth(db, "2026-10");
    await startOn(1);
    const nov = await ensureMonth(db, "2026-11");
    // November starts where October ends (25 Nov) and ends on the new start day.
    expect([nov.startsOn, nov.endsOn]).toEqual(["2026-11-25", "2026-12-01"]);
  });
});

describe("chart filter", () => {
  it("saves the categories left out of the charts", async () => {
    const s = await seedSeptember(db);
    await setChartHiddenCategories(db, [s.groceries.id, s.groceries.id, s.dining.id]);
    const [row] = await db.select().from(settings);
    expect(row.chartHiddenCategoryIds.sort()).toEqual([s.groceries.id, s.dining.id].sort());
    await setChartHiddenCategories(db, []);
    expect((await db.select().from(settings))[0].chartHiddenCategoryIds).toEqual([]);
  });
});

describe("account adjustments", () => {
  it("add + and − with a reason, and remove one added by mistake", async () => {
    const com = await createAccount(db, { name: "ComBank", opening: rs(1000), todayStr: "2026-09-29" });
    const balance = async () => (await getAccounts(db))[0].balance;
    await addAccountAdjustment(db, { accountId: com.id, amount: rs(250), reason: "Interest", todayStr: "2026-09-30" });
    const fee = await addAccountAdjustment(db, { accountId: com.id, amount: -rs(35), reason: "Bank charges", todayStr: "2026-09-30" });
    expect(await balance()).toBe(rs(1000 + 250 - 35));
    await expect(addAccountAdjustment(db, { accountId: com.id, amount: rs(5), reason: " ", todayStr: "2026-09-30" })).rejects.toThrow(/reason/);
    await deleteAccountAdjustment(db, fee.id);
    expect(await balance()).toBe(rs(1250));
  });
});

describe("bank texts", () => {
  const purchase = (where: string, amount: string, day = "12/09/26") =>
    `Dear Cardholder, Purchase at ${where} LK for ${amount} on ${day} 07:47 AM has been authorised on your debit card ending #0000.`;
  const trf = "IB CEFTS trf of LKR 25,000.00 & charge of LKR 25.00 (INT) debited from your A/C ***0001. Avail. Bal. LKR  433,558.50.";
  const ingest = (text: string, receivedOn = "2026-09-20") => ingestMessage(db, { text, sender: "COMBANK", receivedOn });
  const status = async (id: string) => (await db.select().from(capturedMessages).where(eq(capturedMessages.id, id)))[0];

  it("keeps each transaction text once and drops the rest", async () => {
    expect(await ingest(purchase("SPICE LAND", "LKR 570.00"))).toMatchObject({ ignored: false, duplicate: false });
    expect(await ingest(purchase("SPICE LAND", "LKR 570.00"))).toMatchObject({ ignored: false, duplicate: true });
    expect(await ingest("Your OTP is 000000")).toMatchObject({ ignored: true });
    expect(await db.select().from(capturedMessages)).toHaveLength(1);
  });

  it("logs a purchase as an expense on the text's date, once", async () => {
    const s = await seedSeptember(db);
    const com = await createAccount(db, { name: "ComBank", opening: rs(10000), todayStr: "2026-09-01" });
    await ingest(purchase("UBER EATS CBH", "LKR 1,321.76"));
    const [m] = await getPendingMessages(db);
    expect(m).toMatchObject({ kind: "purchase", merchant: "UBER EATS CBH", amount: 132176, occurredOn: "2026-09-12" });

    const expense = { spentOn: m.occurredOn, categoryId: s.dining.id, itemId: null, amount: m.amount!, note: m.merchant, accountId: com.id };
    const res = await logMessage(db, { messageId: m.id, expense });
    expect(res.category?.remaining).toBe(rs(12000) - 132176);
    expect(await status(m.id)).toMatchObject({ status: "logged", expenseId: res.expense.id });
    expect(await getPendingMessages(db)).toEqual([]);
    await expect(logMessage(db, { messageId: m.id, expense })).rejects.toThrow(/already been dealt with/);
    expect(await db.select().from(expenses).where(eq(expenses.spentOn, "2026-09-12"))).toHaveLength(1);
  });

  it("converts dollar charges at the rate of the text's month", async () => {
    await seedSeptember(db);
    expect((await getMonth(db, "2026-09"))!.usdRate).toBe(33000);
    await ingest(purchase("HBOMax help.hbomax.com SG", "USD 4.99"));
    expect((await getPendingMessages(db))[0]).toMatchObject({ amount: 164670, usdRate: 33000, foreignAmount: 499 });

    await saveSetup(db, { ym: "2026-09", defaultAlertPct: 10, currencySymbol: "Rs", currencyCode: "LKR", categories: [], usdRate: 30000 });
    expect((await getPendingMessages(db))[0]).toMatchObject({ amount: 149700, usdRate: 30000 });
    // A new month starts from the previous month's rate; the old month keeps its own.
    expect((await ensureMonth(db, "2026-10")).usdRate).toBe(30000);
    await saveSetup(db, { ym: "2026-10", defaultAlertPct: 10, currencySymbol: "Rs", currencyCode: "LKR", categories: [], usdRate: 31000 });
    expect((await getMonth(db, "2026-09"))!.usdRate).toBe(30000);
    expect((await getPendingMessages(db))[0].amount).toBe(149700);
  });

  it("moves a bank transfer between accounts on the day it arrived, with its charge", async () => {
    await seedSeptember(db);
    const com = await createAccount(db, { name: "ComBank", opening: rs(1000), todayStr: "2026-09-01" });
    const amana = await createAccount(db, { name: "Amana", opening: rs(100000), todayStr: "2026-09-01" });
    const bal = async () => Object.fromEntries((await getAccounts(db)).map((a) => [a.name, a.balance]));
    await ingest(trf);
    await ingest("Withdrawal at HNB MT LAVINI LK for LKR 9,900.00 on 14/09/26 08:06 AM from card ending #0000.");
    const pending = await getPendingMessages(db);
    const t = pending.find((m) => m.kind === "bank_transfer")!;
    const w = pending.find((m) => m.kind === "withdrawal")!;
    expect(t).toMatchObject({ amount: rs(25000), fee: rs(25), accountRef: "0001", occurredOn: "2026-09-20" });

    await logTransfer(db, { messageId: t.id, fromId: amana.id, toId: com.id, amount: t.amount!, fee: t.fee, todayStr: "2026-09-25" });
    expect(await bal()).toEqual({ ComBank: rs(1000 + 25000), Amana: rs(100000 - 25000 - 25) });
    const entries = await db.select().from(accountEntries).where(eq(accountEntries.accountId, amana.id));
    expect(entries.filter((e) => e.kind !== "opening").map((e) => [e.occurredOn, e.kind, e.amount])).toEqual(
      expect.arrayContaining([
        ["2026-09-20", "transfer", -rs(25000)],
        ["2026-09-20", "adjustment", -rs(25)],
      ]),
    );
    expect((await status(t.id)).status).toBe("logged");

    // Without the charge: only the move.
    const cash = await createAccount(db, { name: "Cash in hand", opening: 0, todayStr: "2026-09-01" });
    await logTransfer(db, { messageId: w.id, fromId: com.id, toId: cash.id, amount: w.amount!, fee: null, todayStr: "2026-09-25" });
    expect(await bal()).toMatchObject({ ComBank: rs(26000 - 9900), "Cash in hand": rs(9900) });
  });

  it("keeps texts only from the allowed senders", async () => {
    expect(senderAllowed([], null)).toBe(true);
    expect(senderAllowed(["COMBANK", "Amana Bank"], "AMANABANK")).toBe(true);
    expect(senderAllowed(["COMBANK", "Amana Bank"], "ComBank")).toBe(true);
    expect(senderAllowed(["COMBANK"], "HNB")).toBe(false);
    expect(senderAllowed(["COMBANK"], null)).toBe(false);

    expect(await setMessageSenders(db, [" COMBANK ", "Amana Bank", "amana-bank", ""])).toEqual(["COMBANK", "Amana Bank"]);
    const text = purchase("SPICE LAND", "LKR 570.00");
    expect(await ingestMessage(db, { text, sender: "Scammer", receivedOn: "2026-09-20" })).toMatchObject({ ignored: true, reason: "sender" });
    expect(await ingestMessage(db, { text, receivedOn: "2026-09-20" })).toMatchObject({ ignored: true, reason: "sender" });
    // Pasted into Setup's test box: any sender.
    expect(await ingestMessage(db, { text, sender: "Test", receivedOn: "2026-09-20", anySender: true })).toMatchObject({ ignored: false });
    expect(await ingestMessage(db, { text: trf, sender: "Amana Bank", receivedOn: "2026-09-20" })).toMatchObject({ ignored: false });
    expect(await getPendingMessages(db)).toHaveLength(2);
  });

  it("dismissed texts leave the list and can come back", async () => {
    await ingest(purchase("CARGILLS", "LKR 3,959.37"));
    const [m] = await getPendingMessages(db);
    await dismissMessage(db, m.id);
    expect(await getPendingMessages(db)).toEqual([]);
    await restoreMessage(db, m.id);
    expect((await getPendingMessages(db)).map((x) => x.id)).toEqual([m.id]);
  });
});

describe("removing items per month", () => {
  const setup = (ym: string, categoryId: string, list: { id: string | null; name: string; kind: "monthly" | "as_needed" | "one_off"; expectedAmount?: number | null; removed?: boolean }[]) =>
    saveSetup(db, {
      ym, defaultAlertPct: 10, currencySymbol: "Rs", currencyCode: "LKR",
      categories: [{
        id: categoryId, name: "Groceries", color: "#2F7D6D", alertPct: null, removed: false,
        items: list.map((i) => ({ expectedAmount: null, defaultAmount: null, removed: false, ...i })),
      }],
    });
  const names = async (ym: string) => (await itemsForMonth(db, (await getMonth(db, ym))!.id)).map((i) => i.name);

  it("removing an older item in a later month ends it there; earlier months keep it", async () => {
    const s = await seedSeptember(db);
    const damro = await createItem(db, { categoryId: s.groceries.id, name: "Damro", kind: "as_needed", ym: "2026-09" });
    await db.update(items).set({ createdAt: new Date("2026-09-01T00:00:00Z") });
    await s.expense(s.groceries.id, rs(2000), "2026-09-05", damro.id);
    await ensureMonth(db, "2026-10");
    await ensureMonth(db, "2026-11");

    // Setup for November: remove Damro and the monthly Shop.
    await setup("2026-11", s.groceries.id, [
      { id: s.shop.id, name: "Shop", kind: "monthly", expectedAmount: rs(30000), removed: true },
      { id: damro.id, name: "Damro", kind: "as_needed", removed: true },
    ]);
    const [row] = await db.select().from(items).where(eq(items.id, damro.id));
    expect(row).toMatchObject({ endYm: "2026-10", archivedAt: null });
    expect(await names("2026-10")).toEqual(expect.arrayContaining(["Damro", "Shop"]));
    expect(await names("2026-11")).not.toContain("Damro");
    expect(await names("2026-11")).not.toContain("Shop");

    // Out of November's plan, so not offered when logging in November.
    const offeredIn = async (date: string) => (await getDayView(db, date)).catalog.items.map((i) => i.id);
    expect(await offeredIn("2026-11-10")).not.toContain(damro.id);
    expect(await offeredIn("2026-10-10")).toContain(damro.id);

    // Typing the name again (Setup or the expense sheet) brings the same item back, with its expense.
    const back = await createItem(db, { categoryId: s.groceries.id, name: "damro", kind: "as_needed", ym: "2026-11" });
    expect(back).toMatchObject({ id: damro.id, endYm: null });
    expect(await offeredIn("2026-11-10")).toContain(damro.id);
    expect(await db.select().from(expenses).where(eq(expenses.itemId, damro.id))).toHaveLength(1);
  });

  it("an item added this month, or a one-off, is removed outright", async () => {
    const s = await seedSeptember(db);
    await ensureMonth(db, "2026-10");
    const fresh = await createItem(db, { categoryId: s.groceries.id, name: "Arpico", kind: "as_needed", ym: "2026-10" });
    await db.update(items).set({ createdAt: new Date("2026-10-05T00:00:00Z") }).where(eq(items.id, fresh.id));
    const once = await createItem(db, { categoryId: s.groceries.id, name: "Singer", kind: "one_off", ym: "2026-10" });
    await setup("2026-10", s.groceries.id, [
      { id: fresh.id, name: "Arpico", kind: "as_needed", removed: true },
      { id: once.id, name: "Singer", kind: "one_off", removed: true },
    ]);
    expect(await db.select().from(items).where(eq(items.id, fresh.id))).toEqual([]);
    expect(await db.select().from(items).where(eq(items.id, once.id))).toEqual([]);
  });

  it("re-adding a removed (archived) item's name brings it back with its history", async () => {
    const s = await seedSeptember(db);
    const old = await createItem(db, { categoryId: s.groceries.id, name: "Cargills", kind: "as_needed", ym: "2026-09" });
    await s.expense(s.groceries.id, rs(500), "2026-09-05", old.id);
    await removeItem(db, old.id); // used, so archived rather than deleted
    expect(await names("2026-09")).not.toContain("Cargills");
    const back = await createItem(db, { categoryId: s.groceries.id, name: "Cargills", kind: "as_needed", ym: "2026-09" });
    expect(back).toMatchObject({ id: old.id, archivedAt: null });
  });
});
