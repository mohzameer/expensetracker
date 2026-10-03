"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Sheet } from "./sheet";
import { CreatableCombobox, type ComboOption } from "@/components/combobox";
import { BudgetLine } from "@/components/budget-line";
import { createCategoryAction, createItemAction } from "@/server/actions";
import type { CatalogCategory, CatalogItem, CategorySummary, DueItem, ExpenseRow } from "@/server/queries";
import { stateAfter } from "@/lib/budget";
import { formatAmount, formatMoney, parseMoney, toInputValue } from "@/lib/money";
import { formatDay, formatMonth, periodOf, type Range } from "@/lib/dates";
import { cn } from "@/lib/utils";

export type EntryData = {
  ym: string;
  /** Dates of the budget month shown (e.g. 25 Sep → 25 Oct) and the day months start on. */
  range: Range;
  startDay: number;
  currency: string;
  defaultAlertPct: number;
  summaries: CategorySummary[];
  catalog: { categories: CatalogCategory[]; items: CatalogItem[] };
  monthly: DueItem[];
  accounts: { id: string; name: string; balance: number }[];
  defaultAccountId: string | null;
};

export type ExpensePayload = {
  spentOn: string;
  categoryId: string | null;
  itemId: string | null;
  amount: number;
  note: string | null;
  accountId: string | null;
};

export type ExpenseSheetMode =
  | { kind: "add"; prefill?: { categoryId?: string | null; itemId?: string | null; amount?: number | null } }
  | { kind: "edit"; expense: ExpenseRow };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ExpenseSheetMode;
  date: string;
  data: EntryData;
  onSubmit: (payload: ExpensePayload, id?: string) => void;
  onDelete?: (id: string) => void;
};

const fieldLabel = "text-[13px] font-semibold text-muted-ink";
const inputBox =
  "min-h-[52px] w-full rounded-[14px] border border-line-strong bg-surface px-3.5 text-base outline-none focus:border-[1.5px] focus:border-teal";

export function ExpenseSheet({ open, onOpenChange, mode, date: initialDate, data, onSubmit, onDelete }: Props) {
  const original = mode.kind === "edit" ? mode.expense : null;
  const prefill = mode.kind === "add" ? mode.prefill : undefined;

  const [date, setDate] = useState(original?.spentOn ?? initialDate);
  const [categoryId, setCategoryId] = useState<string | null>(original?.categoryId ?? prefill?.categoryId ?? null);
  const [itemId, setItemId] = useState<string | null>(original?.itemId ?? prefill?.itemId ?? null);
  const [amountStr, setAmountStr] = useState(toInputValue(original?.amount ?? prefill?.amount ?? null));
  // Once you type an amount (or are editing a saved one), picking an item no longer replaces it.
  const [amountTyped, setAmountTyped] = useState(!!original);
  const [note, setNote] = useState(original?.note ?? "");
  // New expenses default to the chosen default account (ComBank); edits keep what was saved.
  const [accountId, setAccountId] = useState<string | null>(
    original?.accountId ?? data.defaultAccountId ?? data.accounts[0]?.id ?? null,
  );
  // "Don't deduct": the money already left your account before you set its balance
  // (e.g. rent paid before you entered today's balance). Counts for budgets only.
  const [noDeduct, setNoDeduct] = useState(!!original && original.accountId === null);
  const [newCategory, setNewCategory] = useState<{ name: string; alertPct: string } | null>(null);
  const [newItem, setNewItem] = useState<{ name: string; kind: "one_off" | "monthly"; amount: string; dueDay: string } | null>(null);
  const [extraCats, setExtraCats] = useState<CatalogCategory[]>([]);
  const [extraItems, setExtraItems] = useState<CatalogItem[]>([]);
  const [creating, startCreating] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const inRange = (d: string) => d >= data.range.from && d < data.range.to;
  const entryYm = inRange(date) ? data.ym : periodOf(date, data.startDay);
  const sameMonth = inRange(date);

  const categories = useMemo(() => {
    const ids = new Set(data.catalog.categories.map((c) => c.id));
    return [...data.catalog.categories, ...extraCats.filter((c) => !ids.has(c.id))];
  }, [data.catalog.categories, extraCats]);
  const items = useMemo(() => {
    const ids = new Set(data.catalog.items.map((i) => i.id));
    return [...data.catalog.items, ...extraItems.filter((i) => !ids.has(i.id))];
  }, [data.catalog.items, extraItems]);

  const summaryFor = (id: string) => data.summaries.find((s) => s.categoryId === id);
  const paidFor = (id: string) => data.monthly.find((m) => m.itemId === id);

  const categoryOptions: ComboOption[] = categories.map((c) => {
    const s = summaryFor(c.id);
    return {
      value: c.id,
      label: c.name,
      color: c.color,
      hint: sameMonth && s ? <span className={s.remaining < 0 ? "text-bad" : undefined}>{formatAmount(s.remaining)}</span> : undefined,
    };
  });
  const itemOptions: ComboOption[] = items
    .filter((i) => i.categoryId === categoryId)
    .map((i) => ({ value: i.id, label: i.name, hint: i.kind === "monthly" ? "Monthly" : undefined }));
  const selectedItem = items.find((i) => i.id === itemId) ?? null;
  const selectedCategory = categories.find((c) => c.id === categoryId) ?? null;

  const amount = parseMoney(amountStr);

  // Live budget line: the cached per-category summary, minus what's being typed.
  const budget = useMemo(() => {
    if (!categoryId || !sameMonth) return null;
    const s = summaryFor(categoryId);
    const effectiveAllocation = s?.effectiveAllocation ?? 0;
    let remaining = s?.remaining ?? 0;
    if (original && original.categoryId === categoryId && inRange(original.spentOn)) remaining += original.amount;
    const alertPct = s?.alertPct ?? data.defaultAlertPct;
    return { effectiveAllocation, remaining, alertPct, ...stateAfter({ effectiveAllocation, remaining, alertPct }, amount ?? 0) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId, sameMonth, data.summaries, amount, original]);

  // Amount defaults: a monthly item fills in its monthly amount; a one-off starts empty.
  const pickItem = (id: string | null) => {
    setItemId(id);
    if (amountTyped) return;
    const it = items.find((i) => i.id === id);
    setAmountStr(it?.kind === "monthly" ? toInputValue(it.expectedAmount) : "");
  };

  const createCategory = () => {
    if (!newCategory) return;
    startCreating(async () => {
      const res = await createCategoryAction({
        name: newCategory.name,
        alertPct: newCategory.alertPct ? Number(newCategory.alertPct) : null,
        ym: entryYm,
      });
      if (!res.ok) return void toast.error(res.error);
      setExtraCats((c) => [...c, { id: res.data.id, name: res.data.name, color: res.data.color }]);
      setCategoryId(res.data.id);
      setItemId(null);
      setNewCategory(null);
    });
  };

  const createItem = () => {
    if (!newItem || !categoryId) return;
    const amt = parseMoney(newItem.amount);
    if (newItem.kind === "monthly" && !amt) return void toast.error("Monthly items need an expected amount.");
    const dueDay = newItem.kind === "monthly" && newItem.dueDay ? Number(newItem.dueDay) : null;
    if (dueDay != null && (dueDay < 1 || dueDay > 31)) return void toast.error("Due day is a day of the month, 1–31.");
    startCreating(async () => {
      const res = await createItemAction({
        categoryId,
        name: newItem.name,
        kind: newItem.kind,
        expectedAmount: newItem.kind === "monthly" ? amt : null,
        defaultAmount: newItem.kind === "one_off" ? amt : null,
        dueDay,
        ym: entryYm,
      });
      if (!res.ok) return void toast.error(res.error);
      setExtraItems((i) => [...i, res.data]);
      setItemId(res.data.id);
      // The amount you just gave the new item (monthly or one-off) becomes this entry's amount.
      if (amt) setAmountStr(toInputValue(amt));
      else if (!amountTyped) setAmountStr("");
      setNewItem(null);
    });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount) return void toast.error("Enter an amount above zero.");
    if (!noDeduct && !accountId) return void toast.error("Choose which account paid.");
    onSubmit(
      {
        spentOn: date,
        categoryId,
        itemId: categoryId ? itemId : null,
        amount,
        note: note.trim() || null,
        accountId: noDeduct ? null : accountId,
      },
      original?.id,
    );
  };

  const warn = budget && budget.state !== "green";
  const spentPct = budget && budget.effectiveAllocation > 0 ? ((budget.effectiveAllocation - budget.remaining) / budget.effectiveAllocation) * 100 : 0;
  const thisPct = budget && budget.effectiveAllocation > 0 ? ((amount ?? 0) / budget.effectiveAllocation) * 100 : 0;

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={original ? "Edit expense" : "Add expense"}
      headerRight={
        <label className="relative flex min-h-9 cursor-pointer items-center rounded-full border border-line bg-paper px-3 text-sm font-medium">
          {formatDay(date)}
          <input
            type="date"
            aria-label="Date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-[18px]">
        {/* Category */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="category" className={fieldLabel}>
            Category
          </label>
          <CreatableCombobox
            id="category"
            options={categoryOptions}
            value={categoryId}
            onChange={(v) => {
              setCategoryId(v);
              setItemId(null);
              setNewItem(null);
              if (!amountTyped) setAmountStr(""); // drop an amount the previous item filled in
            }}
            onCreate={(name) => {
              setNewCategory({ name, alertPct: "" });
              setNewItem(null);
            }}
            emptyOption={{ label: "No category — sort it out later", hint: <span className="text-xs">Needs category</span> }}
            placeholder="Type to find or create"
          />
          {newCategory && (
            <div className="flex flex-col gap-3 rounded-[14px] border border-teal bg-teal-wash p-3.5">
              <div className="text-sm font-semibold text-teal-deep">New category</div>
              <div className="grid grid-cols-[1fr_96px] gap-2.5">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="nc-name" className={fieldLabel}>Name</label>
                  <input id="nc-name" className={inputBox} value={newCategory.name} onChange={(e) => setNewCategory({ ...newCategory, name: e.target.value })} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="nc-alert" className={fieldLabel}>Alert at %</label>
                  <input id="nc-alert" inputMode="numeric" placeholder={String(data.defaultAlertPct)} className={inputBox} value={newCategory.alertPct} onChange={(e) => setNewCategory({ ...newCategory, alertPct: e.target.value.replace(/\D/g, "").slice(0, 3) })} />
                </div>
              </div>
              <p className="text-[13px] text-muted-ink">Its cap is the total of the items you add to it.</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setNewCategory(null)} className="min-h-11 rounded-xl border border-line-strong bg-surface px-4 text-sm font-medium">Cancel</button>
                <button type="button" disabled={creating || !newCategory.name.trim()} onClick={createCategory} className="min-h-11 flex-1 rounded-xl bg-teal text-sm font-semibold text-white disabled:opacity-60">
                  {creating ? "Creating…" : "Create & continue"}
                </button>
              </div>
            </div>
          )}
          {budget && (
            <div className="flex flex-col gap-1.5 px-0.5 pt-0.5">
              <div className="flex h-1.5 overflow-hidden rounded-full bg-line-soft">
                <div className="bg-faint" style={{ width: `${Math.min(Math.max(spentPct, 0), 100)}%` }} />
                <div
                  className={cn(budget.state === "green" ? "bg-ok-bar" : budget.state === "amber" ? "bg-warn-bar" : "bg-bad-bar")}
                  style={{ width: `${Math.min(Math.max(thisPct, 0), Math.max(100 - Math.max(spentPct, 0), 0))}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-ink">
                <span>Spent {formatAmount(budget.effectiveAllocation - budget.remaining)} of {formatAmount(budget.effectiveAllocation)}</span>
                <span>Alert at {budget.alertPct}%</span>
              </div>
            </div>
          )}
        </div>

        {/* Item */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="item" className={fieldLabel}>
            Item <span className="font-normal">(optional)</span>
          </label>
          <CreatableCombobox
            id="item"
            disabled={!categoryId}
            options={itemOptions}
            value={itemId}
            onChange={pickItem}
            onCreate={(name) => setNewItem({ name, kind: "one_off", amount: amountStr, dueDay: "" })}
            emptyOption={{ label: "No item" }}
            placeholder={categoryId ? "Type to find or create" : "Pick a category first"}
            badge={
              selectedItem && (
                <span className="rounded-[10px] bg-paper px-2 py-1 text-xs font-semibold text-muted-ink">
                  {selectedItem.kind === "monthly" ? "Monthly" : "One-off"}
                </span>
              )
            }
          />
          {newItem && (
            <div className="flex flex-col gap-3 rounded-[14px] border border-teal bg-teal-wash p-3.5">
              <div className="text-sm font-semibold text-teal-deep">New item in {selectedCategory?.name}</div>
              <p className="-mt-2 text-[13px] text-muted-ink">
                {newItem.kind === "monthly"
                  ? "Repeats: it stays under this category every month."
                  : `Just for ${formatMonth(entryYm, { month: "long" })}: it won't carry into next month.`}
              </p>
              <input aria-label="Item name" className={inputBox} value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} />
              <div role="radiogroup" aria-label="Kind" className="grid grid-cols-2 gap-1 rounded-xl bg-surface p-1">
                {(["one_off", "monthly"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={newItem.kind === k}
                    onClick={() => setNewItem({ ...newItem, kind: k })}
                    className={cn("min-h-10 rounded-[10px] text-sm font-semibold", newItem.kind === k ? "bg-ink text-white" : "text-muted-ink")}
                  >
                    {k === "one_off" ? "One-off" : "Monthly"}
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="ni-amount" className={fieldLabel}>{newItem.kind === "monthly" ? "Expected each month" : "Planned amount (optional)"}</label>
                <input id="ni-amount" inputMode="decimal" className={inputBox} value={newItem.amount} onChange={(e) => setNewItem({ ...newItem, amount: e.target.value })} />
                <span className="text-xs text-muted-ink">
                  Adds to {selectedCategory?.name}&apos;s cap{newItem.kind === "monthly" ? " every month" : ` for ${formatMonth(entryYm, { month: "long" })}`}.
                </span>
              </div>
              {newItem.kind === "monthly" && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="ni-due" className={fieldLabel}>Due on day of month (optional)</label>
                  <input
                    id="ni-due"
                    inputMode="numeric"
                    placeholder="e.g. 15"
                    className={inputBox}
                    value={newItem.dueDay}
                    onChange={(e) => setNewItem({ ...newItem, dueDay: e.target.value.replace(/\D/g, "").slice(0, 2) })}
                  />
                </div>
              )}
              <div className="flex gap-2">
                <button type="button" onClick={() => setNewItem(null)} className="min-h-11 rounded-xl border border-line-strong bg-surface px-4 text-sm font-medium">Cancel</button>
                <button type="button" disabled={creating || !newItem.name.trim()} onClick={createItem} className="min-h-11 flex-1 rounded-xl bg-teal text-sm font-semibold text-white disabled:opacity-60">
                  {creating ? "Creating…" : "Create item"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Amount */}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="amount" className={fieldLabel}>Amount</label>
          <div className="flex min-h-16 items-baseline gap-2 rounded-[14px] border border-line-strong px-3.5 focus-within:border-[1.5px] focus-within:border-teal">
            <span className="text-lg text-muted-ink">{data.currency}</span>
            <input
              id="amount"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0"
              value={amountStr}
              onChange={(e) => {
                setAmountStr(e.target.value.replace(/[^0-9.,]/g, ""));
                setAmountTyped(true);
              }}
              className="w-24 min-w-0 flex-1 bg-transparent py-2.5 font-display text-[34px] font-semibold text-ink outline-none placeholder:text-line-strong"
            />
          </div>
          {selectedItem?.kind === "monthly" && sameMonth && (() => {
            const st = paidFor(selectedItem.id);
            if (!st) return null;
            return (
              <p className="text-[13px] text-muted-ink">
                {formatAmount(st.paid)} of {formatAmount(st.expected)} paid this month
              </p>
            );
          })()}
        </div>

        {data.accounts.length > 0 && (
          <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
            <legend className={cn(fieldLabel, "pb-1.5")}>Paid from</legend>
            <div className={cn("flex flex-wrap gap-2", noDeduct && "pointer-events-none opacity-40")} aria-disabled={noDeduct}>
              {data.accounts.map((a) => {
                const deducting = !noDeduct && accountId === a.id;
                const after = a.balance - (deducting ? (amount ?? 0) - (original?.accountId === a.id ? original.amount : 0) : 0);
                return (
                  <label
                    key={a.id}
                    className={cn(
                      "flex min-h-12 flex-1 cursor-pointer items-center gap-2.5 rounded-xl border px-3.5",
                      accountId === a.id ? "border-[1.5px] border-teal bg-teal-wash" : "border-line-strong",
                    )}
                  >
                    <input
                      type="radio"
                      name="account"
                      checked={accountId === a.id}
                      onChange={() => setAccountId(a.id)}
                      className="size-[18px] accent-teal"
                    />
                    <span className="flex flex-col">
                      <span className="text-[15px] font-medium">{a.name}</span>
                      <span className={cn("text-xs", deducting && after < 0 ? "font-semibold text-bad" : "text-muted-ink")}>
                        {deducting && amount ? `${formatAmount(after)} after` : formatAmount(a.balance)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            <label className="flex min-h-11 cursor-pointer items-start gap-2.5 pt-1">
              <input
                type="checkbox"
                checked={noDeduct}
                onChange={(e) => setNoDeduct(e.target.checked)}
                className="mt-0.5 size-[18px] shrink-0 accent-teal"
              />
              <span className="flex flex-col">
                <span className="text-sm font-medium">Don&apos;t deduct from an account</span>
                <span className="text-xs text-muted-ink">Already out of your balance (paid before you set it). Still counts for the budget.</span>
              </span>
            </label>
          </fieldset>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="note" className={fieldLabel}>Note <span className="font-normal">(optional)</span></label>
          <input id="note" className={inputBox} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Lunch with team" />
        </div>

        {budget && amount ? (
          <BudgetLine
            state={budget.state}
            remainingAfter={budget.remainingAfter}
            effectiveAllocation={budget.effectiveAllocation}
            pctLeft={budget.pctLeft}
            alertPct={budget.alertPct}
            categoryName={selectedCategory?.name ?? ""}
            currency={data.currency}
            detailed
          />
        ) : null}
        {!categoryId && (
          <p className="text-[13px] text-muted-ink">Saved without a category, it goes to <b>Needs category</b> and won&apos;t count against any budget until assigned.</p>
        )}
        {categoryId && !sameMonth && (
          <p className="text-[13px] text-muted-ink">Counts against {formatMonth(entryYm)}. Its balance will show after saving.</p>
        )}

        <div className="flex gap-2.5 pt-1">
          {original && onDelete ? (
            <button
              type="button"
              onClick={() => (confirmDelete ? onDelete(original.id) : setConfirmDelete(true))}
              className={cn(
                "flex min-h-14 items-center gap-2 rounded-2xl border px-4 text-base font-medium",
                confirmDelete ? "border-bad bg-bad-bg text-bad" : "border-line-strong text-ink",
              )}
            >
              <Trash2 aria-hidden className="size-4" />
              {confirmDelete ? "Delete?" : <span className="sr-only">Delete</span>}
            </button>
          ) : (
            <button type="button" onClick={() => onOpenChange(false)} className="min-h-14 rounded-2xl border border-line-strong px-5 text-base font-medium">
              Cancel
            </button>
          )}
          <button type="submit" className="min-h-14 flex-1 rounded-2xl bg-ink text-[17px] font-semibold text-white">
            {warn && amount ? "Save anyway" : "Save"}
          </button>
        </div>
        {budget?.state === "red" && amount ? (
          <p className="-mt-2 text-center text-[13px] text-muted-ink">
            Saving is never blocked. {selectedCategory?.name} will show {formatMoney(budget.remainingAfter, data.currency)} until covered.
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}
