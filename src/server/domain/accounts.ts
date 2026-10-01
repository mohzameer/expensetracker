import { and, asc, eq, isNull, max } from "drizzle-orm";
import type { Db } from "@/db/client";
import { accountBalances, accountEntries, accounts, settings } from "@/db/schema";
import { UserError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";

export type AccountBalance = { id: string; name: string; balance: number; archived: boolean };

export async function getAccounts(db: Db, includeArchived = false): Promise<AccountBalance[]> {
  const rows = await db
    .select()
    .from(accountBalances)
    .where(includeArchived ? undefined : isNull(accountBalances.archivedAt))
    .orderBy(asc(accountBalances.sortOrder), asc(accountBalances.name));
  return rows.map((r) => ({ id: r.accountId, name: r.name, balance: r.balance, archived: !!r.archivedAt }));
}

export async function totalBalance(db: Db): Promise<number> {
  return (await getAccounts(db, true)).reduce((a, x) => a + x.balance, 0);
}

async function balanceOf(db: Db, id: string) {
  const [row] = await db.select().from(accountBalances).where(eq(accountBalances.accountId, id));
  if (!row) throw new UserError("That account no longer exists.");
  return row;
}

/** Add an account with what's in it today. The first account becomes the default. */
export async function createAccount(db: Db, input: { name: string; opening: number; todayStr: string }) {
  return db.transaction(async (tx) => {
    const [{ top }] = await tx.select({ top: max(accounts.sortOrder) }).from(accounts);
    const [account] = await tx
      .insert(accounts)
      .values({ name: input.name.trim(), sortOrder: (top ?? -1) + 1 })
      .returning();
    if (input.opening !== 0) {
      await tx
        .insert(accountEntries)
        .values({ accountId: account.id, occurredOn: input.todayStr, amount: input.opening, kind: "opening", note: "Opening balance" });
    }
    await tx.update(settings).set({ defaultAccountId: account.id }).where(and(eq(settings.id, 1), isNull(settings.defaultAccountId)));
    return account;
  });
}

/** Match the app to the bank: records the difference as a correction. */
export async function setAccountBalance(db: Db, input: { accountId: string; actual: number; todayStr: string; note?: string | null }) {
  return db.transaction(async (tx) => {
    const current = await balanceOf(tx, input.accountId);
    const diff = input.actual - current.balance;
    if (diff !== 0) {
      await tx.insert(accountEntries).values({
        accountId: input.accountId,
        occurredOn: input.todayStr,
        amount: diff,
        kind: "adjustment",
        note: input.note?.trim() || "Balance corrected",
      });
    }
    return { name: current.name, diff };
  });
}

/** Move money between two of your accounts. */
export async function transferBetweenAccounts(
  db: Db,
  input: { fromId: string; toId: string; amount: number; todayStr: string; note?: string | null },
) {
  if (input.fromId === input.toId) throw new UserError("Pick two different accounts.");
  return db.transaction(async (tx) => {
    const from = await balanceOf(tx, input.fromId);
    const to = await balanceOf(tx, input.toId);
    if (from.balance < input.amount) throw new UserError(`${from.name} only has ${formatMoney(Math.max(from.balance, 0))}.`);
    const group = crypto.randomUUID();
    const note = input.note?.trim() || null;
    await tx.insert(accountEntries).values([
      { accountId: from.accountId, occurredOn: input.todayStr, amount: -input.amount, kind: "transfer", note: note ?? `To ${to.name}`, transferGroup: group },
      { accountId: to.accountId, occurredOn: input.todayStr, amount: input.amount, kind: "transfer", note: note ?? `From ${from.name}`, transferGroup: group },
    ]);
    return { from: from.name, to: to.name };
  });
}

export async function setDefaultAccount(db: Db, accountId: string) {
  await balanceOf(db, accountId);
  await db.update(settings).set({ defaultAccountId: accountId }).where(eq(settings.id, 1));
}

/** A + or − adjustment to an account with its reason (interest, bank charges, cash you forgot…). */
export async function addAccountAdjustment(
  db: Db,
  input: { accountId: string; amount: number; reason: string; todayStr: string },
) {
  if (input.amount === 0) throw new UserError("Enter an amount above zero.");
  if (!input.reason.trim()) throw new UserError("Give a reason for the adjustment.");
  const account = await balanceOf(db, input.accountId);
  const [row] = await db
    .insert(accountEntries)
    .values({ accountId: input.accountId, occurredOn: input.todayStr, amount: input.amount, kind: "adjustment", note: input.reason.trim() })
    .returning();
  return { id: row.id, name: account.name };
}

/** Remove an adjustment added by mistake (opening balances and transfers can't be removed here). */
export async function deleteAccountAdjustment(db: Db, id: string) {
  const [row] = await db.select().from(accountEntries).where(eq(accountEntries.id, id));
  if (!row) return;
  if (row.kind !== "adjustment") throw new UserError("Only adjustments can be removed.");
  await db.delete(accountEntries).where(eq(accountEntries.id, id));
}
