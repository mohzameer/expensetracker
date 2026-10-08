"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowLeftRight, BarChart3, Pencil, Plus, X } from "lucide-react";
import { Sheet } from "@/components/sheets/sheet";
import {
  createAccountAction,
  addAccountAdjustmentAction,
  setAccountBalanceAction,
  deleteAccountAdjustmentAction,
  setDefaultAccountAction,
  transferBetweenAccountsAction,
} from "@/server/actions";
import type { getMoneyPage } from "@/server/queries";
import { formatDay, formatMonth } from "@/lib/dates";
import { formatAmount, formatMoney, parseMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type Data = Awaited<ReturnType<typeof getMoneyPage>>;
type Account = Data["accounts"][number];
type Open = { kind: "add" } | { kind: "balance"; account: Account } | { kind: "transfer"; fromId?: string } | null;

/** Balances and adjustments. On a phone it opens from the day view's banner; the X goes back. */
export function AccountsView({ data, back }: { data: Data; back: string }) {
  const [open, setOpen] = useState<Open>(null);
  const [key, setKey] = useState(0);
  const [filter, setFilter] = useState<string>("all");
  const show = (o: Open) => {
    setKey((k) => k + 1);
    setOpen(o);
  };
  const total = data.accounts.reduce((a, x) => a + x.balance, 0);
  const nameOf = (id: string) => data.accounts.find((a) => a.id === id)?.name ?? "";
  const ledger = filter === "all" ? data.ledger : data.ledger.filter((l) => l.accountId === filter);
  const [, start] = useTransition();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-[22px] px-4 py-6 lg:px-9 lg:py-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex w-full flex-col gap-1.5 lg:w-auto">
          <div className="flex items-center justify-between gap-2">
            <h1 className="font-display text-3xl font-semibold">Accounts</h1>
            <Link href={back} aria-label="Close accounts" className="flex size-11 items-center justify-center rounded-full border border-line bg-surface lg:hidden">
              <X className="size-5" />
            </Link>
          </div>
          <span className="text-sm text-muted-ink">
            Real balances. Expenses come out of the account that paid; adjust a balance when money comes in.
          </span>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[13px] text-muted-ink">Savings</span>
          <span className={cn("font-display text-[40px] leading-tight font-semibold", data.free < 0 ? "text-bad" : "text-teal")}>
            {formatMoney(data.free, data.currency)}
          </span>
          <span className="text-right text-[13px] text-muted-ink">
            {formatMoney(total, data.currency)} in accounts − {formatMoney(data.leftToSpend, data.currency)} left to spend in{" "}
            {formatMonth(data.ym, { month: "long" })}&apos;s budgets
          </span>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.accounts.map((a) => (
          <section key={a.id} className="card flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[17px] font-semibold">{a.name}</h2>
              {data.defaultAccountId === a.id ? (
                <span className="rounded-full bg-teal-wash px-2.5 py-0.5 text-xs font-semibold text-teal">Default</span>
              ) : (
                <button
                  onClick={() =>
                    start(async () => {
                      const res = await setDefaultAccountAction(a.id);
                      if (!res.ok) toast.error(res.error);
                      else toast.success(`${a.name} is now the default`);
                    })
                  }
                  className="text-xs font-medium text-muted-ink underline"
                >
                  Make default
                </button>
              )}
            </div>
            <span className={cn("font-display text-3xl font-semibold", a.balance < 0 && "text-bad")}>{formatMoney(a.balance, data.currency)}</span>
            <div className="flex gap-2">
              <button onClick={() => show({ kind: "balance", account: a })} className="flex min-h-10 items-center gap-1.5 rounded-[10px] border border-line-strong px-3 text-sm font-medium">
                <Pencil aria-hidden className="size-3.5" /> Adjustments
              </button>
              {data.accounts.length > 1 && (
                <button onClick={() => show({ kind: "transfer", fromId: a.id })} className="flex min-h-10 items-center gap-1.5 rounded-[10px] border border-line-strong px-3 text-sm font-medium">
                  <ArrowLeftRight aria-hidden className="size-3.5" /> Transfer
                </button>
              )}
            </div>
          </section>
        ))}
        <button
          onClick={() => show({ kind: "add" })}
          className="flex min-h-[140px] items-center justify-center gap-2 rounded-[14px] border border-dashed border-faint text-[15px] font-semibold text-teal hover:bg-surface"
        >
          <Plus aria-hidden className="size-5" /> Add account
        </button>
      </div>

      <section className="card flex flex-col gap-2 p-5 lg:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[17px] font-semibold">Movements</h2>
          <div className="flex flex-wrap gap-2">
            <Link href={`/charts?from=${encodeURIComponent(`/savings?from=${encodeURIComponent(back)}`)}`} className="flex min-h-10 items-center gap-1.5 rounded-[10px] border border-line-strong px-3.5 text-sm font-medium">
              <BarChart3 aria-hidden className="size-4" /> Spending charts
            </Link>
          </div>
        </div>
        {data.accounts.length > 1 && (
          <div role="tablist" aria-label="Account" className="flex gap-1 rounded-xl bg-paper p-1 text-sm">
            {[{ id: "all", name: "All" }, ...data.accounts].map((a) => (
              <button
                key={a.id}
                role="tab"
                aria-selected={filter === a.id}
                onClick={() => setFilter(a.id)}
                className={cn("min-h-9 flex-1 rounded-[10px] font-semibold", filter === a.id ? "bg-surface shadow-sm" : "text-muted-ink")}
              >
                {a.name}
              </button>
            ))}
          </div>
        )}
        {ledger.length === 0 ? (
          <p className="py-6 text-[15px] text-muted-ink">No movements yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[13px] text-muted-ink">
                <th className="py-2.5 font-medium">Date</th>
                <th className="py-2.5 font-medium">What</th>
                <th className="hidden py-2.5 font-medium sm:table-cell">Type</th>
                {filter === "all" && <th className="py-2.5 font-medium">Account</th>}
                <th className="py-2.5 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((r) => (
                <tr key={r.key} className="border-b border-line-soft last:border-0">
                  <td className="py-2.5 whitespace-nowrap text-muted-ink">{formatDay(r.date, { day: "numeric", month: "short" })}</td>
                  <td className="py-2.5 pr-2">{r.what}</td>
                  <td className="hidden py-2.5 sm:table-cell">{r.type}</td>
                  {filter === "all" && <td className="py-2.5 text-muted-ink">{nameOf(r.accountId)}</td>}
                  <td className={cn("py-2.5 text-right font-semibold", r.amount >= 0 ? "text-ok" : "text-ink")}>
                    {r.amount >= 0 ? "+" : ""}
                    {formatAmount(r.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {open?.kind === "add" && <AddAccountSheet key={key} currency={data.currency} onClose={() => setOpen(null)} />}
      {open?.kind === "balance" && (
        <AdjustmentsSheet
          key={key}
          account={data.accounts.find((a) => a.id === open.account.id) ?? open.account}
          ledger={data.ledger}
          currency={data.currency}
          onClose={() => setOpen(null)}
        />
      )}
      {open?.kind === "transfer" && <TransferSheet key={key} data={data} fromId={open.fromId} onClose={() => setOpen(null)} />}
    </div>
  );
}

const inputCls = "min-h-[52px] w-full rounded-xl border border-line-strong bg-surface px-3.5 text-base outline-none focus:border-teal";
const labelCls = "text-[13px] font-semibold text-muted-ink";
const primary = "min-h-14 rounded-2xl bg-ink text-[17px] font-semibold text-white disabled:opacity-50";

function AddAccountSheet({ currency, onClose }: { currency: string; onClose: () => void }) {
  const [name, setName] = useState("");
  const [opening, setOpening] = useState("");
  const [pending, start] = useTransition();
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Add account" description={<span className="text-muted-ink">A bank account, card or cash.</span>}>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="acc-name" className={labelCls}>Name</label>
        <input id="acc-name" autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="acc-open" className={labelCls}>Balance today ({currency})</label>
        <input id="acc-open" inputMode="decimal" className={inputCls} value={opening} onChange={(e) => setOpening(e.target.value)} />
      </div>
      <button
        disabled={pending || !name.trim()}
        className={primary}
        onClick={() =>
          start(async () => {
            const res = await createAccountAction({ name, opening: parseMoney(opening) ?? 0 });
            if (!res.ok) return void toast.error(res.error);
            toast.success(`Added ${name}`);
            onClose();
          })
        }
      >
        {pending ? "Adding…" : "Add account"}
      </button>
    </Sheet>
  );
}

/**
 * The account's adjustments, each with a reason. Two ways to add one:
 * a + / − amount, or the total the account should show (the app works out the difference).
 */
function AdjustmentsSheet({
  account,
  ledger,
  currency,
  onClose,
}: {
  account: Account;
  ledger: Data["ledger"];
  currency: string;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"change" | "total">("change");
  const [sign, setSign] = useState<1 | -1>(-1);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const value = parseMoney(amount) ?? 0;
  // "Set balance to": the typed figure is the new total; the adjustment is the difference.
  const target = parseMoney(amount);
  const diff = target == null ? null : target - account.balance;
  const list = ledger.filter((l) => l.accountId === account.id && l.adjustmentId);
  const signed = (n: number) => `${n > 0 ? "+" : "−"}${formatAmount(Math.abs(n))}`;

  const add = () =>
    start(async () => {
      if (mode === "total") {
        const res = await setAccountBalanceAction({ accountId: account.id, actual: target!, note: reason });
        if (!res.ok) return void toast.error(res.error);
        toast.success(
          res.data.diff === 0 ? `${account.name} already matches` : `${account.name} set to ${formatAmount(target!)} (${signed(res.data.diff)})`,
        );
      } else {
        const res = await addAccountAdjustmentAction({ accountId: account.id, amount: sign * value, reason });
        if (!res.ok) return void toast.error(res.error);
        toast.success(`${signed(sign * value)} to ${account.name}`);
      }
      setAmount("");
      setReason("");
    });
  const remove = (id: string) =>
    start(async () => {
      const res = await deleteAccountAdjustmentAction(id);
      if (!res.ok) toast.error(res.error);
      else toast("Adjustment removed");
    });

  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${account.name} adjustments`}
      description={
        <span className="text-muted-ink">
          Balance {formatMoney(account.balance, currency)}. Add or take off an amount, or set the balance to what the bank shows — each
          with a reason.
        </span>
      }
    >
      <div className="flex flex-col gap-2.5 rounded-xl border border-line p-3">
        <div role="tablist" aria-label="How to adjust" className="grid grid-cols-2 gap-1 rounded-xl bg-paper p-1">
          {(
            [
              ["change", "+ / − amount"],
              ["total", "Set balance to"],
            ] as const
          ).map(([m, label]) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => {
                setMode(m);
                setAmount("");
              }}
              className={cn("min-h-10 rounded-[10px] text-sm font-semibold", mode === m ? "bg-surface shadow-sm" : "text-muted-ink")}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === "total" ? (
          <div className="flex flex-col gap-1">
            <input
              aria-label="New balance"
              inputMode="decimal"
              placeholder={`What ${account.name} shows now`}
              className={inputCls}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <span className="text-[13px] text-muted-ink">
              {diff == null
                ? `The app has ${formatAmount(account.balance)}.`
                : diff === 0
                  ? "Already matches — nothing to adjust."
                  : `That's an adjustment of ${signed(diff)} from ${formatAmount(account.balance)}.`}
            </span>
          </div>
        ) : (
        <div className="flex gap-2">
          <div role="radiogroup" aria-label="Plus or minus" className="grid shrink-0 grid-cols-2 gap-1 rounded-xl bg-paper p-1">
            {([1, -1] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={sign === v}
                aria-label={v > 0 ? "Plus (money in)" : "Minus (money out)"}
                onClick={() => setSign(v)}
                className={cn(
                  "flex size-11 items-center justify-center rounded-[10px] text-xl font-semibold",
                  sign === v ? (v > 0 ? "bg-ok text-white" : "bg-ink text-white") : "text-muted-ink",
                )}
              >
                {v > 0 ? "+" : "−"}
              </button>
            ))}
          </div>
          <input
            aria-label="Amount"
            inputMode="decimal"
            placeholder="Amount"
            className={cn(inputCls, "min-w-0 flex-1")}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
        )}
        <input
          aria-label="Reason"
          placeholder="Reason, e.g. Bank charges, Interest"
          className={inputCls}
          value={reason}
          maxLength={120}
          onChange={(e) => setReason(e.target.value)}
        />
        <button
          disabled={pending || !reason.trim() || (mode === "total" ? diff == null || diff === 0 : !value)}
          className={primary}
          onClick={add}
        >
          {pending
            ? "Saving…"
            : mode === "total"
              ? diff
                ? `Set to ${formatMoney(target!, currency)} (${signed(diff)})`
                : "Set balance"
              : `Add ${sign > 0 ? "+" : "−"}${formatMoney(value, currency)}`}
        </button>
      </div>

      {list.length === 0 ? (
        <p className="text-center text-sm text-muted-ink">No adjustments yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line-soft rounded-xl border border-line">
          {list.map((l) => (
            <li key={l.key} className="flex items-center gap-3 px-3.5 py-2.5">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[15px]">{l.what}</span>
                <span className="text-xs text-muted-ink">{formatDay(l.date, { day: "numeric", month: "short" })}</span>
              </div>
              <span className={cn("font-semibold", l.amount >= 0 ? "text-ok" : "text-ink")}>
                {l.amount >= 0 ? "+" : ""}
                {formatAmount(l.amount)}
              </span>
              <button
                type="button"
                disabled={pending}
                aria-label={`Remove ${l.what}`}
                onClick={() => l.adjustmentId && remove(l.adjustmentId)}
                className="flex size-9 items-center justify-center rounded-lg text-muted-ink hover:bg-paper hover:text-bad"
              >
                <X aria-hidden className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

function TransferSheet({ data, fromId, onClose }: { data: Data; fromId?: string; onClose: () => void }) {
  const [from, setFrom] = useState(fromId ?? data.accounts[0]?.id ?? "");
  const [to, setTo] = useState(data.accounts.find((a) => a.id !== (fromId ?? data.accounts[0]?.id))?.id ?? "");
  const [amount, setAmount] = useState("");
  const [pending, start] = useTransition();
  const value = parseMoney(amount) ?? 0;
  const fromAcc = data.accounts.find((a) => a.id === from);
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Transfer between accounts">
      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tr-from" className={labelCls}>From</label>
          <select id="tr-from" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)}>
            {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="tr-to" className={labelCls}>To</label>
          <select id="tr-to" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)}>
            {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="tr-amt" className={labelCls}>Amount · {fromAcc ? `${formatAmount(fromAcc.balance)} in ${fromAcc.name}` : ""}</label>
        <input id="tr-amt" inputMode="decimal" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <button
        disabled={pending || !value || from === to}
        className={primary}
        onClick={() =>
          start(async () => {
            const res = await transferBetweenAccountsAction({ fromId: from, toId: to, amount: value, note: null });
            if (!res.ok) return void toast.error(res.error);
            toast.success(`Moved ${formatMoney(value, data.currency)} from ${res.data.from} to ${res.data.to}`);
            onClose();
          })
        }
      >
        {pending ? "Moving…" : `Move ${formatMoney(value, data.currency)}`}
      </button>
    </Sheet>
  );
}
