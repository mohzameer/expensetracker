import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accounts, incomes, months, transfers } from "@/db/schema";
import { UserError } from "@/lib/errors";
import { assertOpen } from "./months";

async function loadIncome(db: Db, id: string) {
  const [row] = await db
    .select({ income: incomes, month: months })
    .from(incomes)
    .innerJoin(months, eq(months.id, incomes.monthId))
    .where(eq(incomes.id, id))
    .for("update");
  if (!row) throw new UserError("That income line no longer exists.");
  assertOpen(row.month);
  return row;
}

/** Money arrived: it's now in the line's account. */
export async function receiveIncome(db: Db, id: string, todayStr: string) {
  return db.transaction(async (tx) => {
    const { income } = await loadIncome(tx, id);
    if (income.status === "received") throw new UserError(`${income.source} is already marked received.`);
    if (!income.accountId) throw new UserError(`Choose which account ${income.source} goes into (in Setup) first.`);
    const [account] = await tx.select().from(accounts).where(eq(accounts.id, income.accountId));
    await tx.update(incomes).set({ status: "received", receivedOn: todayStr }).where(eq(incomes.id, id));
    return { source: income.source, amount: income.amount, account: account?.name ?? "" };
  });
}

/** Undo a "received" mark: the line is expected again and leaves the account. */
export async function undoReceiveIncome(db: Db, id: string) {
  return db.transaction(async (tx) => {
    const { income } = await loadIncome(tx, id);
    if (income.status !== "received") return;
    await tx.update(incomes).set({ status: "expected", receivedOn: null, transferId: null }).where(eq(incomes.id, id));
    // Income received before accounts existed was recorded as a Savings transfer.
    if (income.transferId) await tx.delete(transfers).where(eq(transfers.id, income.transferId));
  });
}
