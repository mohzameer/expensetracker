"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowLeftRight, BarChart3, Pencil, Plus } from "lucide-react";
import { Sheet } from "@/components/sheets/sheet";
import {
  createAccountAction,
  moveToCategoryAction,
  setAccountBalanceAction,
  setDefaultAccountAction,
  transferBetweenAccountsAction,
} from "@/server/actions";
import type { getMoneyPage } from "@/server/queries";
import { formatDay, formatMonth } from "@/lib/dates";
import { formatAmount, formatMoney, parseMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type Data = Awaited<ReturnType<typeof getMoneyPage>>;
type Account = Data["accounts"][number];
type Open = { kind: "add" } | { kind: "balance"; account: Account } | { kind: "transfer"; fromId?: string } | { kind: "topup" } | null;

export function AccountsView({ data }: { data: Data }) {
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
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-3xl font-semibold">Accounts</h1>
          <span className="text-sm text-muted-ink">
            Real balances. Expenses come out of the account that paid; income goes into its account when received.
          </span>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[13px] text-muted-ink">Free now</span>
          <span className={cn("font-display text-[40px] leading-tight font-semibold", data.free < 0 ? "text-bad" : "text-teal")}>
            {formatMoney(data.free, data.currency)}
          </span>
          <span className="text-right text-[13px] text-muted-ink">
            {formatMoney(total, data.currency)} in accounts − {formatMoney(data.leftToSpend, data.currency)} left to spend in{" "}
            {formatMonth(data.ym, { month: "long" })}&apos;s budgets
          </span>
          {data.expected.length > 0 && (
            <span className="text-right text-[13px] text-muted-ink">
              Expected: {data.expected.map((e) => `${e.source} ${formatAmount(e.amount)}`).join(" · ")}
            </span>
          )}
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
                <Pencil aria-hidden className="size-3.5" /> Update balance
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
            <Link href="/charts?from=/savings" className="flex min-h-10 items-center gap-1.5 rounded-[10px] border border-line-strong px-3.5 text-sm font-medium">
              <BarChart3 aria-hidden className="size-4" /> Spending charts
            </Link>
            <button onClick={() => show({ kind: "topup" })} className="min-h-10 rounded-[10px] border border-line-strong px-3.5 text-sm font-medium">
              Top up a budget
            </button>
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
      {open?.kind === "balance" && <BalanceSheet key={key} account={open.account} currency={data.currency} onClose={() => setOpen(null)} />}
      {open?.kind === "transfer" && <TransferSheet key={key} data={data} fromId={open.fromId} onClose={() => setOpen(null)} />}
      {open?.kind === "topup" && <TopUpSheet key={key} data={data} onClose={() => setOpen(null)} />}
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

function BalanceSheet({ account, currency, onClose }: { account: Account; currency: string; onClose: () => void }) {
  const [actual, setActual] = useState("");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const value = parseMoney(actual);
  const diff = value == null ? null : value - account.balance;
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Update ${account.name}`}
      description={<span className="text-muted-ink">Enter what the bank shows. The app records the difference as a correction.</span>}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="bal" className={labelCls}>Balance now ({currency}) · app shows {formatAmount(account.balance)}</label>
        <input id="bal" autoFocus inputMode="decimal" className={inputCls} value={actual} onChange={(e) => setActual(e.target.value)} />
        {diff !== null && diff !== 0 && (
          <span className="text-[13px] text-muted-ink">
            Correction of {diff > 0 ? "+" : ""}
            {formatAmount(diff)}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="bal-note" className={labelCls}>Note (optional)</label>
        <input id="bal-note" className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Bank charges" />
      </div>
      <button
        disabled={pending || value == null}
        className={primary}
        onClick={() =>
          start(async () => {
            const res = await setAccountBalanceAction({ accountId: account.id, actual: value!, note: note || null });
            if (!res.ok) return void toast.error(res.error);
            toast.success(res.data.diff === 0 ? `${account.name} already matches` : `${account.name} updated`);
            onClose();
          })
        }
      >
        {pending ? "Saving…" : "Save balance"}
      </button>
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

/** Raise a budget out of free money (what used to be "Move from Savings"). */
function TopUpSheet({ data, onClose }: { data: Data; onClose: () => void }) {
  const [categoryId, setCategoryId] = useState(data.categories[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [pending, start] = useTransition();
  const value = parseMoney(amount) ?? 0;
  return (
    <Sheet
      open
      onOpenChange={(o) => !o && onClose()}
      title="Top up a budget"
      description={<span className="text-muted-ink">Raises this month&apos;s cap using free money. No money moves between accounts.</span>}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="tu-cat" className={labelCls}>Category</label>
        <select id="tu-cat" className={inputCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="tu-amt" className={labelCls}>Amount · {formatMoney(Math.max(data.free, 0), data.currency)} free</label>
        <input id="tu-amt" inputMode="decimal" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <button
        disabled={pending || !value || value > data.free}
        className={primary}
        onClick={() =>
          start(async () => {
            const res = await moveToCategoryAction({ ym: data.ym, toCategoryId: categoryId, source: { kind: "savings" }, amount: value, reason: "manual" });
            if (!res.ok) return void toast.error(res.error);
            toast.success(`Added ${formatMoney(value, data.currency)} to ${data.categories.find((c) => c.id === categoryId)?.name}`);
            onClose();
          })
        }
      >
        {pending ? "Saving…" : `Add ${formatMoney(value, data.currency)}`}
      </button>
    </Sheet>
  );
}
