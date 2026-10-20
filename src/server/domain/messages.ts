import { createHash } from "node:crypto";
import { and, desc, eq, max } from "drizzle-orm";
import type { Db } from "@/db/client";
import { capturedMessages, months } from "@/db/schema";
import { UserError } from "@/lib/errors";
import { convertUsd, DEFAULT_USD_RATE } from "@/lib/money";
import { parseBankSms, type MessageKind } from "@/lib/sms";
import { addAccountAdjustment, transferBetweenAccounts } from "./accounts";
import { createExpense, type ExpenseInput } from "./expenses";

/** Bank texts the automation can send are short; anything longer isn't one. */
export const MAX_MESSAGE_LENGTH = 2000;

/** A text from the iPhone automation: dropped if it isn't a transaction, stored once otherwise. */
export async function ingestMessage(db: Db, input: { text: string; sender?: string | null; receivedOn: string }) {
  const body = input.text.trim();
  if (body.length > MAX_MESSAGE_LENGTH) throw new UserError("That message is too long to be a bank text.");
  const parsed = parseBankSms(body, input.receivedOn);
  if (!parsed) return { ignored: true as const, duplicate: false, parsed: null };
  const bodyHash = createHash("sha256").update(body.replace(/\s+/g, " ")).digest("hex");
  const [row] = await db
    .insert(capturedMessages)
    .values({ body, sender: input.sender?.trim().slice(0, 100) || null, bodyHash, ...parsed })
    .onConflictDoNothing()
    .returning({ id: capturedMessages.id });
  return { ignored: false as const, duplicate: !row, parsed };
}

async function lockPending(db: Db, id: string) {
  const [msg] = await db.select().from(capturedMessages).where(eq(capturedMessages.id, id)).for("update");
  if (!msg) throw new UserError("That message no longer exists.");
  if (msg.status !== "pending") throw new UserError("That message has already been dealt with.");
  return msg;
}

/** Save a purchase text as an expense; the message leaves the list. */
export async function logMessage(db: Db, input: { messageId: string; expense: ExpenseInput }) {
  return db.transaction(async (tx) => {
    await lockPending(tx, input.messageId);
    const res = await createExpense(tx, input.expense);
    await tx
      .update(capturedMessages)
      .set({ status: "logged", expenseId: res.expense.id, resolvedAt: new Date() })
      .where(eq(capturedMessages.id, input.messageId));
    return res;
  });
}

/** A withdrawal or bank transfer → a move between accounts on the text's date, plus its bank charge. */
export async function logTransfer(
  db: Db,
  input: { messageId: string; fromId: string; toId: string; amount: number; fee: number | null; todayStr: string },
) {
  return db.transaction(async (tx) => {
    const msg = await lockPending(tx, input.messageId);
    const moved = await transferBetweenAccounts(tx, { ...input, occurredOn: msg.occurredOn, note: null });
    if (input.fee) {
      await addAccountAdjustment(tx, {
        accountId: input.fromId,
        amount: -input.fee,
        reason: "Bank charge",
        todayStr: input.todayStr,
        occurredOn: msg.occurredOn,
      });
    }
    await tx
      .update(capturedMessages)
      .set({ status: "logged", transferGroup: moved.group, resolvedAt: new Date() })
      .where(eq(capturedMessages.id, input.messageId));
    return { from: moved.from, to: moved.to };
  });
}

export async function dismissMessage(db: Db, id: string) {
  await db
    .update(capturedMessages)
    .set({ status: "dismissed", resolvedAt: new Date() })
    .where(and(eq(capturedMessages.id, id), eq(capturedMessages.status, "pending")));
}

export async function restoreMessage(db: Db, id: string) {
  await db
    .update(capturedMessages)
    .set({ status: "pending", resolvedAt: null })
    .where(and(eq(capturedMessages.id, id), eq(capturedMessages.status, "dismissed")));
}

export type PendingMessage = {
  id: string;
  kind: MessageKind;
  merchant: string | null;
  /** Local amount; for dollar charges, converted at the rate of the text's month. */
  amount: number | null;
  fee: number | null;
  foreignCurrency: string | null;
  foreignAmount: number | null;
  /** The rate a dollar amount was converted at. */
  usdRate: number | null;
  accountRef: string | null;
  occurredOn: string;
  body: string;
};

/** Texts waiting to be logged, newest first. */
export async function getPendingMessages(db: Db): Promise<PendingMessage[]> {
  const [rows, monthRates] = await Promise.all([
    db
      .select()
      .from(capturedMessages)
      .where(eq(capturedMessages.status, "pending"))
      .orderBy(desc(capturedMessages.occurredOn), desc(capturedMessages.receivedAt)),
    db.select({ startsOn: months.startsOn, endsOn: months.endsOn, usdRate: months.usdRate }).from(months).orderBy(desc(months.startsOn)),
  ]);
  // The month the text falls in (read-only: no month is created for it), else the latest month.
  const rateOn = (date: string) => (monthRates.find((m) => m.startsOn <= date && date < m.endsOn) ?? monthRates[0])?.usdRate ?? DEFAULT_USD_RATE;
  return rows.map((m) => {
    const usd = m.foreignCurrency === "USD" && m.foreignAmount != null;
    const usdRate = usd ? rateOn(m.occurredOn) : null;
    return {
      id: m.id,
      kind: m.kind,
      merchant: m.merchant,
      amount: usd ? convertUsd(m.foreignAmount!, usdRate!) : m.amount,
      fee: m.fee,
      foreignCurrency: m.foreignCurrency,
      foreignAmount: m.foreignAmount,
      usdRate,
      accountRef: m.accountRef,
      occurredOn: m.occurredOn,
      body: m.body,
    };
  });
}

export async function lastMessageAt(db: Db): Promise<Date | null> {
  const [row] = await db.select({ at: max(capturedMessages.receivedAt) }).from(capturedMessages);
  return row?.at ?? null;
}
