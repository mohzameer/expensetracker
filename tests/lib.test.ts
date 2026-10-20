import { describe, expect, it } from "vitest";
import { convertUsd, formatAmount, formatMoney, parseMoney, toInputValue } from "@/lib/money";
import { parseBankSms } from "@/lib/sms";
import { budgetState, paidInCalendarMonth, stateAfter } from "@/lib/budget";
import { addDays, addMonths, clampToMonth, diffMonths, isIsoDate, lastDay, relativeDay, today } from "@/lib/dates";
import { cycleGrid, groupByDay, inRange, itemKey, monthBuckets, monthOfRange, presetRange, rangeBars, rowKey, searchRows, topItems, type ItemRef, type Row, type Search } from "@/lib/analysis";

describe("money", () => {
  it("parses input into minor units without floats", () => {
    expect(parseMoney("1,800")).toBe(180000);
    expect(parseMoney("Rs 12,400.75")).toBe(1240075);
    expect(parseMoney("0.1")).toBe(10);
    expect(parseMoney("19.99")).toBe(1999);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney(".")).toBeNull();
    expect(parseMoney("1.234")).toBeNull();
  });
  it("formats", () => {
    expect(formatAmount(1240000)).toBe("12,400");
    expect(formatAmount(180050)).toBe("1,800.50");
    expect(formatMoney(-135000)).toBe("−Rs 1,350");
    expect(toInputValue(180050)).toBe("1800.50");
    expect(toInputValue(180000)).toBe("1800");
  });
});

describe("budgetState", () => {
  it("green above the threshold, amber at or below it, red below zero", () => {
    expect(budgetState(1500000, 1240000, 10)).toBe("green");
    expect(budgetState(1500000, 150000, 10)).toBe("amber");
    expect(budgetState(1500000, 130000, 10)).toBe("amber");
    expect(budgetState(1500000, 0, 10)).toBe("amber");
    expect(budgetState(1500000, -1, 10)).toBe("red");
  });
  it("matches the Transport example from the proposal", () => {
    const r = stateAfter({ effectiveAllocation: 1500000, remaining: 310000, alertPct: 10 }, 180000);
    expect(r.remainingAfter).toBe(130000);
    expect(r.pctLeft.toFixed(1)).toBe("8.7");
    expect(r.state).toBe("amber");
  });
});

describe("paid twice in a month", () => {
  const pay = (id: string, itemId: string, spentOn: string) => ({ id, itemId, spentOn, amount: 100 });
  const payments = [pay("b", "net", "2026-10-20"), pay("a", "net", "2026-10-03"), pay("c", "net", "2026-09-28"), pay("d", "gym", "2026-10-05")];

  it("finds the item's other payments in the calendar month, not the budget cycle", () => {
    // A budget cycle of 25 Sep → 24 Oct would also hold 28 Sep; the calendar month doesn't.
    expect(paidInCalendarMonth(payments, "net", "2026-10-19").map((p) => p.id)).toEqual(["a", "b"]);
    expect(paidInCalendarMonth(payments, "net", "2026-11-01")).toEqual([]);
    expect(paidInCalendarMonth(payments, "gym", "2026-10-31").map((p) => p.id)).toEqual(["d"]);
  });

  it("leaves out the expense being edited", () => {
    expect(paidInCalendarMonth(payments, "net", "2026-10-03", "a").map((p) => p.id)).toEqual(["b"]);
  });
});

describe("dates", () => {
  it("does calendar math on strings", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(lastDay("2028-02")).toBe("2028-02-29");
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(clampToMonth("2026-10-05", "2026-09")).toBe("2026-09-30");
    expect(relativeDay("2026-08-31", "2026-09-29")).toBe("29 days ago");
  });
  it("computes today in the app timezone", () => {
    // 20:00 UTC on the 29th is already the 30th in Colombo (UTC+5:30).
    expect(today("Asia/Colombo", new Date("2026-09-29T20:00:00Z"))).toBe("2026-09-30");
  });
});

describe("analysis", () => {
  const row = (date: string, amount: number, itemName: string | null, categoryId: string | null = "food", extra: Partial<Row> = {}): Row => ({
    id: `${date}-${amount}-${itemName}`,
    date,
    amount,
    note: null,
    categoryId,
    categoryName: categoryId === "food" ? "Food" : categoryId === "ride" ? "Rides" : null,
    color: "#000",
    itemName,
    accountId: "bank",
    ...extra,
  });
  const cats = [
    { id: "food", name: "Food", color: "#111" },
    { id: "ride", name: "Rides", color: "#222" },
  ];
  const item = (
    categoryId: string, name: string, kind: ItemRef["kind"], amount: number | null, ym: string | null,
    extra: Partial<ItemRef> = {},
  ): ItemRef => ({
    categoryId, name, kind, expectedAmount: kind === "monthly" ? amount : null, defaultAmount: kind !== "monthly" ? amount : null,
    ym, archived: false, createdOn: "2026-01-01", skippedIn: [], endYm: null, ...extra,
  });

  it("identifies an item by category and name, so one-offs join up across months", () => {
    expect(itemKey("ride", "Uber")).toBe(itemKey("ride", " uber "));
    expect(itemKey("ride", "Uber")).not.toBe(itemKey("food", "Uber"));
    expect(rowKey(row("2026-10-01", 100, null))).toBe("food:");
    expect(rowKey(row("2026-10-01", 100, null, null))).toBe("none:");
  });

  it("builds ranges on pay-cycle months and Mon–Sun weeks", () => {
    // Saturday 3 Oct 2026, months start on the 25th → "September" is 25 Sep – 24 Oct.
    expect(presetRange("month", "2026-10-03", 25)).toEqual({ from: "2026-09-25", to: "2026-10-25" });
    expect(presetRange("last_month", "2026-10-03", 25)).toEqual({ from: "2026-08-25", to: "2026-09-25" });
    expect(presetRange("last_3", "2026-10-03", 25)).toEqual({ from: "2026-07-25", to: "2026-10-25" });
    expect(presetRange("week", "2026-10-03", 25)).toEqual({ from: "2026-09-28", to: "2026-10-05" });
    expect(presetRange("month", "2026-10-03", 1)).toEqual({ from: "2026-10-01", to: "2026-11-01" });
    expect(monthOfRange({ from: "2026-09-25", to: "2026-10-25" }, 25)).toBe("2026-09");
    expect(monthOfRange({ from: "2026-09-28", to: "2026-10-05" }, 25)).toBeNull();
    expect(inRange("2026-10-25", { from: "2026-09-25", to: "2026-10-25" })).toBe(false);
  });

  it("groups entries by day, newest first", () => {
    const days = groupByDay([row("2026-10-01", 500, "Uber"), row("2026-10-03", 200, "Uber"), row("2026-10-01", 300, "Uber")]);
    expect(days.map((d) => [d.date, d.total, d.rows.length])).toEqual([["2026-10-03", 200, 1], ["2026-10-01", 800, 2]]);
  });

  it("charts a day per bar for short ranges, a week per bar for long ones, and never past today", () => {
    const rows = [row("2026-09-25", 100, "a"), row("2026-10-03", 250, "a")];
    const daily = rangeBars(rows, { from: "2026-09-25", to: "2026-10-25" }, "2026-10-03");
    expect(daily).toHaveLength(9);
    expect([daily[0].value, daily[8].value]).toEqual([100, 250]);
    const weekly = rangeBars(rows, { from: "2026-07-25", to: "2026-10-25" }, "2026-10-03");
    expect(weekly.length).toBeGreaterThan(9);
    expect(weekly.reduce((a, b) => a + b.value, 0)).toBe(350);
  });

  it("averages finished months only, from the first month with spending", () => {
    const rows = [row("2026-08-01", 3000, "Net"), row("2026-08-30", 5000, "Net"), row("2026-10-01", 9000, "Net")];
    const { months, average } = monthBuckets(rows, "2026-10-03", 25);
    expect(months).toHaveLength(12);
    expect(months.slice(-3).map((m) => [m.ym, m.total, m.current])).toEqual([
      ["2026-07", 3000, false],
      ["2026-08", 5000, false],
      ["2026-09", 9000, true],
    ]);
    expect(average).toBe(4000);
    expect(monthBuckets([], "2026-10-03", 25).average).toBeNull();
  });

  it("ranks items and compares them with the plan for a single month", () => {
    const rows = [row("2026-10-01", 1760, "Uber", "ride"), row("2026-10-02", 6000, "Shop"), row("2026-10-03", 2000, "shop"), row("2026-10-03", 240, null)];
    const items = [
      item("food", "Shop", "monthly", 10000, null),
      item("ride", "Uber", "one_off", 1250, "2026-09"),
      item("ride", "Uber", "one_off", 900, "2026-08"), // another month's one-off: ignored
      item("food", "Gas", "monthly", 3000, null), // planned, nothing spent yet
      item("food", "Old", "monthly", 500, null, { archived: true }), // archived and unused: hidden
      item("food", "New", "monthly", 700, null, { createdOn: "2026-11-02" }), // didn't exist yet: hidden
    ];
    const top = topItems(rows, items, cats, "2026-09", 25);
    expect(top.map((t) => [t.name, t.total, t.planned])).toEqual([["Shop", 8000, 10000], ["Uber", 1760, 1250], [null, 240, null], ["Gas", 0, 3000]]);
    expect(top[0].share).toBeCloseTo(0.8);
    // Without a single month there is no plan to compare with.
    expect(topItems(rows, items, cats, null, 25).map((t) => t.planned)).toEqual([null, null, null]);
  });

  it("lays a budget month out as a grid: items under categories with the days they were paid", () => {
    const rows = [
      row("2026-10-02", 21000, "Internet"),
      row("2026-09-28", 1000, "Uber", "ride"),
      row("2026-10-01", 760, "Uber", "ride"),
      row("2026-10-01", 240, "Uber", "ride"), // same day twice: one paid date
      row("2026-10-03", 300, null),
      row("2026-10-03", 90, null, null),
      row("2026-08-01", 5000, "Internet"), // another cycle
    ];
    const items = [
      item("food", "Internet", "monthly", 25000, null),
      item("food", "Water", "monthly", 27000, null), // unpaid, still listed
      item("food", "Gas", "monthly", 3000, null, { skippedIn: ["2026-09"] }), // left out of September
      item("ride", "Uber", "one_off", 1250, "2026-09"),
      item("ride", "Tuk", "one_off", null, "2026-09"), // no amount, nothing spent: not listed
      item("food", "Later", "monthly", 900, null, { createdOn: "2026-11-02" }),
    ];
    const grid = cycleGrid(rows, items, cats, "2026-09", 25);
    expect(grid.categories.map((c) => [c.name, c.planned, c.spent])).toEqual([["Food", 52000, 21300], ["Rides", 1250, 2000], ["Needs category", 0, 90]]);
    expect([grid.planned, grid.spent]).toEqual([53250, 23390]);
    expect(grid.categories[0].items.map((i) => [i.name, i.skipped, i.paidOn, i.planned, i.spent])).toEqual([
      ["Internet", false, ["2026-10-02"], 25000, 21000],
      ["Water", false, [], 27000, 0],
      ["Gas", true, [], null, 0], // skipped: shown, nothing planned
      [null, false, ["2026-10-03"], null, 300],
    ]);
    expect(grid.categories[1].items).toEqual([
      { key: "ride:uber", name: "Uber", kind: "one_off", skipped: false, paidOn: ["2026-09-28", "2026-10-01"], planned: 1250, spent: 2000 },
    ]);
    // An item past its last month plans nothing afterwards, in the grid or in Top items.
    const ended = [...items, item("food", "Lease", "monthly", 9000, null, { endYm: "2026-09" })];
    expect(cycleGrid([], ended, cats, "2026-09", 25).categories[0].items.map((i) => i.name)).toContain("Lease");
    expect(cycleGrid([], ended, cats, "2026-10", 25).categories[0].items.map((i) => i.name)).not.toContain("Lease");
    expect(topItems([], ended, cats, "2026-10", 25).map((t) => t.name)).not.toContain("Lease");
    // Skipping is per month: Gas is planned again in October, and Top items leaves a skipped, unspent item out.
    expect(cycleGrid([], items, cats, "2026-10", 25).categories[0].items.find((i) => i.name === "Gas")).toMatchObject({ skipped: false, planned: 3000 });
    expect(topItems([], items, cats, "2026-09", 25).map((t) => t.name)).not.toContain("Gas");
    // The item created in November isn't planned for September, but is for November.
    expect(cycleGrid([], items, cats, "2026-11", 25).categories[0].items.map((i) => i.name)).toContain("Later");
  });

  it("an as-needed item plans nothing: listed only in the months it was paid", () => {
    const items = [item("food", "Doctor", "as_needed", 2500, null)]; // the usual amount is only a prefill
    const rows = [row("2026-10-02", 3200, "Doctor")];
    expect(cycleGrid(rows, items, cats, "2026-09", 25).categories[0].items).toMatchObject([{ name: "Doctor", kind: "as_needed", planned: null, spent: 3200 }]);
    expect(cycleGrid(rows, items, cats, "2026-09", 25).categories[0].planned).toBe(0);
    expect(topItems(rows, items, cats, "2026-09", 25).map((t) => [t.name, t.total, t.planned])).toEqual([["Doctor", 3200, null]]);
    // A month it didn't come up in doesn't list it.
    expect(cycleGrid([], items, cats, "2026-10", 25).categories).toEqual([]);
    expect(topItems([], items, cats, "2026-10", 25)).toEqual([]);
  });

  it("finds entries by note, item or category, and by account", () => {
    const rows = [
      row("2026-10-01", 100, "Uber", "ride", { note: "Airport run" }),
      row("2026-10-02", 200, "Shop", "food", { accountId: null }),
      row("2026-08-02", 300, "Shop", "food"),
    ];
    const range = { from: "2026-09-25", to: "2026-10-25" };
    const find = (s: Partial<Search>) => searchRows(rows, { q: "", categoryId: null, accountId: null, range, ...s }).map((r) => r.amount);
    expect(find({})).toEqual([200, 100]);
    expect(find({ q: "AIRPORT" })).toEqual([100]);
    expect(find({ q: "shop" })).toEqual([200]);
    expect(find({ q: "rides" })).toEqual([100]);
    expect(find({ accountId: "none" })).toEqual([200]);
    expect(find({ categoryId: "ride", accountId: "bank" })).toEqual([100]);
  });
});

describe("month arithmetic", () => {
  it("counts whole months between two budget months", () => {
    expect(diffMonths("2026-11", "2026-09")).toBe(2);
    expect(diffMonths("2026-09", "2026-09")).toBe(0);
    expect(diffMonths("2027-02", "2026-11")).toBe(3);
    expect(diffMonths(addMonths("2026-09", 11), "2026-09")).toBe(11);
  });
});

describe("bank sms", () => {
  const got = "2026-10-20";
  const card = (s: string) => `Dear Cardholder, ${s} has been authorised on your debit card ending #0000.`;

  it("reads card purchases in rupees", () => {
    expect(parseBankSms(card("Purchase at SPICE LAND RESTURANT DEHIWALA LK for LKR 570.00 on 20/10/26 07:47 AM"), got)).toEqual({
      kind: "purchase",
      merchant: "SPICE LAND RESTURANT DEHIWALA",
      amount: 57000,
      fee: null,
      foreignCurrency: null,
      foreignAmount: null,
      accountRef: null,
      occurredOn: "2026-10-20",
    });
    const uber = parseBankSms(card("Purchase at UBER EATS CBH LK for LKR 1,321.76 on 19/10/26 04:57 PM"), got);
    expect(uber).toMatchObject({ merchant: "UBER EATS CBH", amount: 132176, occurredOn: "2026-10-19" });
    const cafe = parseBankSms(card("Purchase at CORNE-FA CAFE & BAKERS DEHIWALA LK for LKR 100.00 on 19/10/26 07:27 AM"), got);
    expect(cafe).toMatchObject({ merchant: "CORNE-FA CAFE & BAKERS DEHIWALA", amount: 10000 });
    const cargills = parseBankSms(card("Purchase at CARGILLS FOODCITY-MT.L MT.LAVINIA LK for LKR 3,959.37 on 17/10/26 06:53 PM"), got);
    expect(cargills).toMatchObject({ merchant: "CARGILLS FOODCITY-MT.L MT.LAVINIA", amount: 395937, occurredOn: "2026-10-17" });
  });

  it("keeps foreign charges in their currency", () => {
    const hbo = parseBankSms(card("Purchase at HBOMax help.hbomax.com SG SG for USD 4.99 on 18/10/26 01:56 PM"), got);
    expect(hbo).toMatchObject({ kind: "purchase", merchant: "HBOMax help.hbomax.com", amount: null, foreignCurrency: "USD", foreignAmount: 499 });
    expect(convertUsd(499, 33000)).toBe(164670);
    expect(convertUsd(499, 30000)).toBe(149700);
    expect(convertUsd(1, 33333)).toBe(333);
  });

  it("reads ATM withdrawals", () => {
    expect(
      parseBankSms("Withdrawal at Hatton National Bank HNB MT LAVINI LK for LKR 9,900.00 on 14/10/26 08:06 AM from card ending #0000.", got),
    ).toMatchObject({ kind: "withdrawal", merchant: "Hatton National Bank HNB MT LAVINI", amount: 990000, occurredOn: "2026-10-14" });
    expect(
      parseBankSms(
        "Withdrawal at MT LAVINIA-1 BR MOUNT LAVINIACOLK for LKR 19,900.00 on 13/10/26 11:28 AM from card ending #0000. Click link to view the Digital Receipt for Withdrawal performed at ComBank ATMs",
        got,
      ),
    ).toMatchObject({ kind: "withdrawal", merchant: "MT LAVINIA-1 BR MOUNT LAVINIACOLK", amount: 1990000, occurredOn: "2026-10-13" });
  });

  it("reads internet-banking transfers with their charge, dated the day they arrived", () => {
    const trf = (n: string, bal: string) =>
      `IB CEFTS trf of LKR ${n} & charge of LKR 25.00 (INT) debited from your A/C ***0001. Avail. Bal. LKR  ${bal}. Enq 0110000000`;
    expect(parseBankSms(trf("25,000.00", "433,558.50"), got)).toEqual({
      kind: "bank_transfer",
      merchant: null,
      amount: 2500000,
      fee: 2500,
      foreignCurrency: null,
      foreignAmount: null,
      accountRef: "0001",
      occurredOn: got,
    });
    expect(parseBankSms(trf("20,000.00", "458,583.50"), got)).toMatchObject({ amount: 2000000, fee: 2500 });
  });

  it("drops OTPs, declined cards and account POS debits", () => {
    const drop = [
      "Dear Cardholder, your card was declined due to insufficient funds. The attempted transaction amount was LKR 21,915.00 at DAMRO-DEHIWELA DEHIWELA LK on 18/10/26 10:39 AM. Please check your balance and try again.",
      "Dear Cardholder, Your card was declined due to insufficient funds. The attempted transaction amount was LKR 9,900.00 at Hatton National Bank HNB MT LAVINI LK on 14/10/26 08:04 AM. Please check your balance and try again.",
      "Dear Cardholder, please verify the merchant name and transaction amount before entering the One Time Password (OTP). Keep your OTP confidential and do not share it with anyone. Your OTP at Merchant 'NDB' for LKR 5,024.00 is 000000",
      "Your OTP is 000000",
      "OTP is confidential. Do not share with anyone.Contact 0110000000 if you did not request for an OTP",
      "POS trx of LKR 21,915.00 at DAMRO-DEHIWELA DEHIWELA LK authorised from your A/C ***0001. Avail. Bal. LKR 478,608.50. Enq 0110000000",
      "   ",
    ];
    for (const text of drop) expect(parseBankSms(text, got)).toBeNull();
  });

  it("keeps anything else, with whatever amount it can find", () => {
    expect(parseBankSms("Your standing order of Rs. 4,500 was processed", got)).toMatchObject({ kind: "other", amount: 450000, merchant: null });
    expect(parseBankSms("Something happened on your account", got)).toMatchObject({ kind: "other", amount: null, occurredOn: got });
  });
});
