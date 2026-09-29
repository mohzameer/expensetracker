import { z } from "zod";
import { isIsoDate, isYearMonth } from "./dates";

// Shared by client forms and Server Actions. Amounts are integer minor units.

export const isoDate = z.string().refine(isIsoDate, "Invalid date");
export const yearMonth = z.string().refine(isYearMonth, "Invalid month");
export const amount = z.number().int().positive("Enter an amount above zero").max(1e13);
export const optionalAmount = z.number().int().positive().max(1e13).nullable();
export const alertPct = z.number().int().min(0).max(100);
export const name = z.string().trim().min(1, "Name is required").max(60);
export const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
export const id = z.uuid();

export const expenseInput = z.object({
  spentOn: isoDate,
  categoryId: id.nullable(),
  itemId: id.nullable(),
  amount,
  note: z.string().trim().max(200).nullable(),
  accountId: id.nullable(), // null only when editing an expense from before accounts existed
});

/** New expenses must say which account paid. */
export const newExpenseInput = expenseInput.extend({ accountId: z.uuid("Choose which account paid") });

export const newAccountInput = z.object({ name, opening: z.number().int().min(-1e13).max(1e13) });
export const setBalanceInput = z.object({ accountId: id, actual: z.number().int().min(-1e13).max(1e13), note: z.string().trim().max(200).nullable() });
export const accountTransferInput = z.object({ fromId: id, toId: id, amount, note: z.string().trim().max(200).nullable() });

export const newCategoryInput = z.object({
  name,
  allocation: z.number().int().min(0).max(1e13).nullable(),
  alertPct: alertPct.nullable(),
  ym: yearMonth,
});

export const newItemInput = z
  .object({
    categoryId: id,
    name,
    kind: z.enum(["monthly", "one_off"]),
    expectedAmount: optionalAmount,
    defaultAmount: optionalAmount,
    ym: yearMonth,
  })
  .refine((v) => v.kind !== "monthly" || v.expectedAmount, { message: "Monthly items need an expected amount" });

export const transferSource = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("category"), categoryId: id }),
  z.object({ kind: z.literal("savings") }),
]);

export const moveInput = z.object({
  ym: yearMonth,
  toCategoryId: id,
  source: transferSource,
  amount,
  reason: z.enum(["cover", "manual"]).default("cover"),
  note: z.string().trim().max(200).nullable().default(null),
});

export const savingsAdjustInput = z.object({
  direction: z.enum(["in", "out"]),
  amount,
  note: z.string().trim().max(200).nullable(),
});

const setupItem = z.object({
  id: id.nullable(),
  name,
  kind: z.enum(["monthly", "one_off"]),
  expectedAmount: optionalAmount,
  defaultAmount: optionalAmount,
  removed: z.boolean(),
});

export const setupInput = z.object({
  ym: yearMonth,
  defaultAlertPct: alertPct,
  currencySymbol: z.string().trim().min(1).max(6),
  currencyCode: z.string().trim().min(3).max(3).toUpperCase(),
  categories: z.array(
    z.object({
      id: id.nullable(),
      name,
      color,
      allocation: z.number().int().min(0).max(1e13),
      alertPct: alertPct.nullable(),
      removed: z.boolean(),
      items: z.array(setupItem),
    }),
  ),
  incomes: z
    .array(z.object({ source: z.string().trim().min(1, "Every income line needs a source").max(60), amount, accountId: id.nullable() }))
    .optional(),
  defaultAccountId: id.nullable().optional(),
  defaultIncome: z.object({ source: z.string().trim().max(60), amount: optionalAmount }).optional(),
});
