import { describe, expect, it } from "vitest";
import { formatAmount, formatMoney, parseMoney, toInputValue } from "@/lib/money";
import { budgetState, stateAfter } from "@/lib/budget";
import { addDays, addMonths, clampToMonth, isIsoDate, lastDay, relativeDay, today } from "@/lib/dates";

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
