import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { incomes, months, transfers } from "@/db/schema";
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

/** Money arrived: deposit it into Savings and mark the line received. */
export async function receiveIncome(db: Db, id: string, todayStr: string) {
  return db.transaction(async (tx) => {
    const { income } = await loadIncome(tx, id);
    if (income.status === "received") throw new UserError(`${income.source} is already marked received.`);
    const [deposit] = await tx
      .insert(transfers)
      .values({
        monthId: income.monthId,
        fromKind: "external",
        toKind: "savings",
        amount: income.amount,
        reason: "income",
        note: income.source,
        occurredOn: todayStr,
      })
      .returning();
    await tx
      .update(incomes)
      .set({ status: "received", receivedOn: todayStr, transferId: deposit.id })
      .where(eq(incomes.id, id));
    return { source: income.source, amount: income.amount };
  });
}

/** Undo a "received" mark: the deposit is removed and the line is expected again. */
export async function undoReceiveIncome(db: Db, id: string) {
  return db.transaction(async (tx) => {
    const { income } = await loadIncome(tx, id);
    if (income.status !== "received" || !income.transferId) return;
    await tx
      .update(incomes)
      .set({ status: "expected", receivedOn: null, transferId: null })
      .where(and(eq(incomes.id, id), eq(incomes.status, "received")));
    await tx.delete(transfers).where(eq(transfers.id, income.transferId));
  });
}
