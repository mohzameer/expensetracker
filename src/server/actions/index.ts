"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getSession, passcodeMatches } from "@/lib/auth";
import { today } from "@/lib/dates";
import * as s from "@/lib/schemas";
import { runAction } from "@/server/action";
import { createCategory, createItem, saveSetup, setChartHiddenCategories, setItemComplete } from "@/server/domain/catalog";
import { assignCategory, createExpense, deleteExpense, updateExpense } from "@/server/domain/expenses";
import { closeMonth } from "@/server/domain/months";
import { dismissMessage, ingestMessage, logMessage, logTransfer, restoreMessage, setMessageSenders } from "@/server/domain/messages";
import { adjustSavings, moveToCategory } from "@/server/domain/transfers";
import { receiveIncome, undoReceiveIncome } from "@/server/domain/incomes";
import {
  addAccountAdjustment,
  createAccount,
  deleteAccountAdjustment,
  setAccountBalance,
  setDefaultAccount,
  transferBetweenAccounts,
} from "@/server/domain/accounts";

// ---- auth ----

export async function loginAction(_prev: { error?: string } | undefined, form: FormData) {
  const passcode = String(form.get("passcode") ?? "");
  const next = String(form.get("next") ?? "/");
  // A small fixed delay makes guessing slow without any extra state.
  await new Promise((r) => setTimeout(r, 400));
  if (!passcodeMatches(passcode)) return { error: "That passcode isn't right." };
  const session = await getSession();
  session.loggedIn = true;
  await session.save();
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logoutAction() {
  const session = await getSession();
  session.destroy();
  redirect("/login");
}

// ---- expenses ----

export async function createExpenseAction(input: z.input<typeof s.newExpenseInput>) {
  return runAction(s.newExpenseInput, input, (db, d) => createExpense(db, d));
}

export async function updateExpenseAction(input: { id: string; expense: z.input<typeof s.expenseInput> }) {
  const schema = z.object({ id: s.id, expense: s.expenseInput });
  return runAction(schema, input, (db, d) => updateExpense(db, d.id, d.expense));
}

export async function deleteExpenseAction(id: string) {
  return runAction(s.id, id, (db, d) => deleteExpense(db, d));
}

export async function assignCategoryAction(input: { id: string; categoryId: string }) {
  const schema = z.object({ id: s.id, categoryId: s.id });
  return runAction(schema, input, (db, d) => assignCategory(db, d.id, d.categoryId));
}

// ---- catalog ----

export async function createCategoryAction(input: z.input<typeof s.newCategoryInput>) {
  return runAction(s.newCategoryInput, input, (db, d) => createCategory(db, d));
}

export async function createItemAction(input: z.input<typeof s.newItemInput>) {
  return runAction(s.newItemInput, input, (db, d) => createItem(db, d));
}

export async function saveSetupAction(input: z.input<typeof s.setupInput>) {
  return runAction(s.setupInput, input, (db, d) => saveSetup(db, d));
}

// ---- money moves ----

export async function moveToCategoryAction(input: z.input<typeof s.moveInput>) {
  return runAction(s.moveInput, input, (db, d) => moveToCategory(db, { ...d, todayStr: today() }));
}

export async function adjustSavingsAction(input: z.input<typeof s.savingsAdjustInput>) {
  return runAction(s.savingsAdjustInput, input, (db, d) => adjustSavings(db, { ...d, todayStr: today() }));
}

export async function closeMonthAction(ym: string) {
  return runAction(s.yearMonth, ym, (db, d) => closeMonth(db, d, today()));
}

// ---- income ----

export async function receiveIncomeAction(id: string) {
  return runAction(s.id, id, (db, d) => receiveIncome(db, d, today()));
}

export async function undoReceiveIncomeAction(id: string) {
  return runAction(s.id, id, (db, d) => undoReceiveIncome(db, d));
}

// ---- accounts ----

export async function createAccountAction(input: z.input<typeof s.newAccountInput>) {
  return runAction(s.newAccountInput, input, (db, d) => createAccount(db, { ...d, todayStr: today() }));
}

export async function setAccountBalanceAction(input: z.input<typeof s.setBalanceInput>) {
  return runAction(s.setBalanceInput, input, (db, d) => setAccountBalance(db, { ...d, todayStr: today() }));
}

export async function transferBetweenAccountsAction(input: z.input<typeof s.accountTransferInput>) {
  return runAction(s.accountTransferInput, input, (db, d) => transferBetweenAccounts(db, { ...d, todayStr: today() }));
}

export async function addAccountAdjustmentAction(input: z.input<typeof s.adjustmentInput>) {
  return runAction(s.adjustmentInput, input, (db, d) => addAccountAdjustment(db, { ...d, todayStr: today() }));
}

export async function deleteAccountAdjustmentAction(entryId: string) {
  return runAction(s.id, entryId, (db, d) => deleteAccountAdjustment(db, d));
}

export async function setDefaultAccountAction(accountId: string) {
  return runAction(s.id, accountId, (db, d) => setDefaultAccount(db, d));
}

// ---- charts ----

export async function setItemCompleteAction(input: { itemId: string; ym: string; complete: boolean }) {
  const schema = z.object({ itemId: s.id, ym: s.yearMonth, complete: z.boolean() });
  return runAction(schema, input, (db, d) => setItemComplete(db, d));
}

export async function setChartHiddenCategoriesAction(ids: string[]) {
  return runAction(z.array(s.id).max(500), ids, (db, d) => setChartHiddenCategories(db, d));
}

// ---- bank texts ----

export async function logMessageAction(input: z.input<typeof s.logMessageInput>) {
  return runAction(s.logMessageInput, input, (db, d) => logMessage(db, d));
}

export async function logTransferAction(input: z.input<typeof s.logTransferInput>) {
  return runAction(s.logTransferInput, input, (db, d) => logTransfer(db, { ...d, todayStr: today() }));
}

export async function dismissMessageAction(id: string) {
  return runAction(s.id, id, (db, d) => dismissMessage(db, d));
}

export async function restoreMessageAction(id: string) {
  return runAction(s.id, id, (db, d) => restoreMessage(db, d));
}

/** Setup guide's test box: the same path as the iPhone automation, without the token. */
export async function testMessageAction(input: z.input<typeof s.testMessageInput>) {
  return runAction(s.testMessageInput, input, (db, d) => ingestMessage(db, { text: d.text, sender: "Test", receivedOn: today(), anySender: true }));
}

export async function setMessageSendersAction(names: string[]) {
  return runAction(s.messageSendersInput, names, (db, d) => setMessageSenders(db, d));
}
