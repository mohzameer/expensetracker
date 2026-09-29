"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Sheet } from "@/components/sheets/sheet";
import { ColumnChart } from "@/components/charts/column-chart";
import { adjustSavingsAction, moveToCategoryAction } from "@/server/actions";
import type { getSavingsPage } from "@/server/queries";
import { formatDay, formatMonth } from "@/lib/dates";
import { formatAmount, formatMoney, parseMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type Data = Awaited<ReturnType<typeof getSavingsPage>>;
type Ledger = Data["ledger"];

const TYPE: Record<string, string> = { month_close: "Month close", cover: "Cover", manual: "Manual" };

/** One row per month-close sweep (the per-category rows are summed). */
function groupLedger(rows: Ledger) {
  const out: { key: string; date: string; what: string; type: string; amount: number }[] = [];
  const sweeps = new Map<string, (typeof out)[number]>();
  for (const r of rows) {
    if (r.reason === "month_close") {
      const existing = sweeps.get(r.yearMonth);
      if (existing) {
        existing.amount += r.signed;
        continue;
      }
      const row = { key: `close-${r.yearMonth}`, date: r.occurredOn, what: `${formatMonth(r.yearMonth, { month: "long" })} leftovers`, type: TYPE.month_close, amount: r.signed };
      sweeps.set(r.yearMonth, row);
      out.push(row);
      continue;
    }
    const what =
      r.note ??
      (r.reason === "cover" && r.toName
        ? `${r.toName} overspend`
        : r.toName
          ? `Moved to ${r.toName}`
          : r.signed > 0
            ? "Deposit"
            : "Withdrawal");
    out.push({ key: r.id, date: r.occurredOn, what, type: TYPE[r.reason], amount: r.signed });
  }
  return out;
}

export function SavingsView({ data }: { data: Data }) {
  const [sheet, setSheet] = useState<null | "move" | "adjust">(null);
  const [key, setKey] = useState(0);
  const rows = groupLedger(data.ledger);
  const openMonth = data.perMonth.find((m) => m.status === "open");

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-[22px] px-4 py-6 lg:px-9 lg:py-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="font-display text-3xl font-semibold">Savings</h1>
          <span className="text-sm text-muted-ink">Leftovers swept in at month close. Covers for overspending come out of here.</span>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[13px] text-muted-ink">Balance</span>
          <span className="font-display text-[40px] leading-tight font-semibold text-teal">{formatMoney(data.balance, data.currency)}</span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <section className="card flex flex-col gap-4 p-5 lg:col-span-2 lg:p-6">
          <h2 className="text-[17px] font-semibold">Net saved per month</h2>
          {data.perMonth.length === 0 ? (
            <p className="text-[15px] text-muted-ink">Nothing yet — close a month to sweep its leftovers here.</p>
          ) : (
            <ColumnChart
              ariaLabel="Net saved per month"
              data={data.perMonth.map((m) => ({
                label: formatMonth(m.yearMonth, { month: "short" }),
                value: m.net,
                muted: m.status === "open",
                detail: m.status === "open" ? "Still open" : `Swept in ${formatAmount(m.sweptIn)}`,
              }))}
            />
          )}
          <span className="text-[13px] text-muted-ink">
            Sweep in minus covers taken out that month.{openMonth ? ` ${formatMonth(openMonth.yearMonth, { month: "long" })} is still open.` : ""}
          </span>
        </section>

        <section className="card flex flex-col gap-2 p-5 lg:col-span-3 lg:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[17px] font-semibold">All movements</h2>
            <div className="flex gap-2">
              <button
                onClick={() => (setKey((k) => k + 1), setSheet("adjust"))}
                className="min-h-10 rounded-[10px] border border-line-strong px-3.5 text-sm font-medium"
              >
                Adjust
              </button>
              <button
                onClick={() => (setKey((k) => k + 1), setSheet("move"))}
                className="min-h-10 rounded-[10px] border border-line-strong px-3.5 text-sm font-medium"
              >
                Move to a category
              </button>
            </div>
          </div>
          {rows.length === 0 ? (
            <p className="py-6 text-[15px] text-muted-ink">No movements yet. Use Adjust to record a starting balance.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[13px] text-muted-ink">
                  <th className="py-2.5 font-medium">Date</th>
                  <th className="py-2.5 font-medium">What</th>
                  <th className="hidden py-2.5 font-medium sm:table-cell">Type</th>
                  <th className="py-2.5 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-b border-line-soft last:border-0">
                    <td className="py-2.5 whitespace-nowrap text-muted-ink">{formatDay(r.date, { day: "numeric", month: "short" })}</td>
                    <td className="py-2.5 pr-2">{r.what}</td>
                    <td className="hidden py-2.5 sm:table-cell">{r.type}</td>
                    <td className={cn("py-2.5 text-right font-semibold", r.amount >= 0 ? "text-ok" : "text-bad")}>
                      {r.amount >= 0 ? "+" : ""}
                      {formatAmount(r.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {sheet === "move" && <MoveSheet key={key} data={data} onClose={() => setSheet(null)} />}
      {sheet === "adjust" && <AdjustSheet key={key} data={data} onClose={() => setSheet(null)} />}
    </div>
  );
}

const inputCls = "min-h-[52px] w-full rounded-xl border border-line-strong bg-surface px-3.5 text-base outline-none focus:border-teal";
const labelCls = "text-[13px] font-semibold text-muted-ink";

function MoveSheet({ data, onClose }: { data: Data; onClose: () => void }) {
  const [categoryId, setCategoryId] = useState(data.categories[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [pending, start] = useTransition();
  const value = parseMoney(amount) ?? 0;
  const submit = () =>
    start(async () => {
      const res = await moveToCategoryAction({ ym: data.ym, toCategoryId: categoryId, source: { kind: "savings" }, amount: value, reason: "manual" });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Moved ${formatMoney(value, data.currency)} to ${data.categories.find((c) => c.id === categoryId)?.name}`);
      onClose();
    });
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Move to a category" description={<span className="text-muted-ink">Adds to this month&apos;s cap for that category.</span>}>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="mv-cat" className={labelCls}>Category</label>
        <select id="mv-cat" className={inputCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          {data.categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="mv-amt" className={labelCls}>Amount · {formatMoney(data.balance, data.currency)} available</label>
        <input id="mv-amt" inputMode="decimal" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <button
        disabled={pending || !value || value > data.balance || !categoryId}
        onClick={submit}
        className="min-h-14 rounded-2xl bg-ink text-[17px] font-semibold text-white disabled:opacity-50"
      >
        {pending ? "Moving…" : `Move ${formatMoney(value, data.currency)}`}
      </button>
    </Sheet>
  );
}

function AdjustSheet({ data, onClose }: { data: Data; onClose: () => void }) {
  const [direction, setDirection] = useState<"in" | "out">("in");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState(data.ledger.length ? "" : "Starting balance");
  const [pending, start] = useTransition();
  const value = parseMoney(amount) ?? 0;
  const submit = () =>
    start(async () => {
      const res = await adjustSavingsAction({ direction, amount: value, note: note.trim() || null });
      if (!res.ok) return void toast.error(res.error);
      toast.success(direction === "in" ? `Added ${formatMoney(value, data.currency)} to Savings` : `Took ${formatMoney(value, data.currency)} out of Savings`);
      onClose();
    });
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Adjust Savings" description={<span className="text-muted-ink">For a starting balance, a deposit, or money you took out.</span>}>
      <div role="radiogroup" aria-label="Direction" className="grid grid-cols-2 gap-1 rounded-xl bg-paper p-1">
        {(["in", "out"] as const).map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={direction === d}
            onClick={() => setDirection(d)}
            className={cn("min-h-11 rounded-[10px] text-sm font-semibold", direction === d ? "bg-ink text-white" : "text-muted-ink")}
          >
            {d === "in" ? "Add money" : "Take money out"}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="adj-amt" className={labelCls}>Amount</label>
        <input id="adj-amt" inputMode="decimal" className={inputCls} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="adj-note" className={labelCls}>Note</label>
        <input id="adj-note" className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <button
        disabled={pending || !value || (direction === "out" && value > data.balance)}
        onClick={submit}
        className="min-h-14 rounded-2xl bg-ink text-[17px] font-semibold text-white disabled:opacity-50"
      >
        {pending ? "Saving…" : "Save"}
      </button>
    </Sheet>
  );
}
