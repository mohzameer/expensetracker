import Link from "next/link";
import { Download, Plus } from "lucide-react";
import { MonthHeader } from "@/components/page-header";
import { ColumnChart } from "@/components/charts/column-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import type { getDashboard } from "@/server/queries";
import { formatMonth } from "@/lib/dates";
import { formatAmount, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type Data = Awaited<ReturnType<typeof getDashboard>>;

const BAR = { green: "bg-ok-bar", amber: "bg-warn-bar", red: "bg-bad-bar" } as const;
const TEXT = { green: "text-ok", amber: "text-warn", red: "text-bad" } as const;

export function Dashboard({ data, today }: { data: Data; today: string }) {
  const { totals, currency } = data;
  const negatives = data.summaries.filter((s) => s.remaining < 0);
  // At most 7 coloured slices; the rest fold into "Other" so colours never repeat.
  const spent = data.summaries.filter((s) => s.spent > 0).sort((a, b) => b.spent - a.spent);
  const top = spent.length > 8 ? spent.slice(0, 7) : spent;
  const rest = spent.slice(top.length).reduce((a, s) => a + s.spent, 0) + totals.uncategorized;
  const slices = [
    ...top.map((s) => ({ name: s.name, value: s.spent, color: s.color })),
    ...(rest > 0
      ? [{ name: spent.length > top.length ? (totals.uncategorized ? "Other + needs category" : "Other") : "Needs category", value: rest, color: "var(--faint)" }]
      : []),
  ];
  const unallocated = data.incomeTotal - totals.allocated;
  const weekPace = Math.round((data.evenPacePerDay * 7) / 100) * 100; // whole rupees
  const closed = data.month?.status === "closed";

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-[22px] px-4 py-6 lg:px-9 lg:py-7">
      <MonthHeader ym={data.ym} href={(ym) => `/dashboard?month=${ym}`}>
        <div className="flex gap-2">
          <a
            href={`/api/export?month=${data.ym}`}
            className="flex min-h-11 items-center gap-2 rounded-xl border border-line-strong bg-surface px-4 text-[15px] font-medium"
          >
            <Download aria-hidden className="size-4" /> CSV
          </a>
          <Link
            href={`/day/${today}`}
            className="flex min-h-11 items-center gap-1.5 rounded-xl bg-ink px-[18px] text-[15px] font-semibold text-white"
          >
            <Plus aria-hidden className="size-4" /> Add expense
          </Link>
        </div>
      </MonthHeader>

      {!data.month ? (
        <div className="card px-6 py-12 text-center text-[15px] text-muted-ink">
          Nothing recorded for {formatMonth(data.ym)}.{" "}
          <Link href={`/setup?month=${data.ym}`} className="font-semibold text-teal underline">
            Set up its budgets
          </Link>
        </div>
      ) : (
        <>
          {data.income.length > 0 ? (
            <section className="card flex flex-wrap items-center gap-x-8 gap-y-3 px-5 py-4" aria-label="Income">
              <Figure label="Income" value={formatMoney(data.incomeTotal, currency)} />
              <span aria-hidden className="text-xl text-faint">−</span>
              <Figure label="Budgeted" value={formatMoney(totals.allocated, currency)} />
              <span aria-hidden className="text-xl text-faint">=</span>
              <Figure
                label={unallocated < 0 ? "Over-budgeted" : "Unallocated"}
                value={formatMoney(Math.abs(unallocated), currency)}
                className={unallocated < 0 ? "text-bad" : "text-ok"}
              />
              <ul className="ml-auto flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted-ink">
                {data.income.map((i) => (
                  <li key={i.id}>
                    {i.source} <span className="font-semibold text-ink">{formatAmount(i.amount)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <p className="-mt-2 text-[13px] text-muted-ink">
              No income recorded for {formatMonth(data.ym, { month: "long" })}.{" "}
              <Link href={`/setup?month=${data.ym}`} className="font-semibold text-teal underline">
                Add it in Setup
              </Link>
            </p>
          )}

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Tile label="Allocated" value={formatMoney(totals.allocated, currency)} sub={`${data.summaries.length} categories`} />
            <Tile
              label="Spent"
              value={formatMoney(totals.spent, currency)}
              sub={`${totals.allocated ? Math.round((totals.spent / totals.allocated) * 100) : 0}% of allocated`}
            />
            <Tile
              label={closed ? "Swept to Savings" : "Left"}
              value={formatMoney(closed ? data.summaries.reduce((a, s) => a + s.swept, 0) : totals.left, currency)}
              valueClass={closed ? undefined : totals.left < 0 ? "text-bad" : "text-ok"}
              sub={
                negatives.length ? (
                  <span className="text-bad">
                    {negatives.map((n) => `${n.name} ${formatAmount(n.remaining)}`).join(", ")} uncovered
                  </span>
                ) : closed ? (
                  "Month closed"
                ) : (
                  "Nothing overspent"
                )
              }
            />
            <Tile
              label="Monthly items owed"
              value={formatMoney(totals.owed, currency)}
              sub={data.owed.length ? data.owed.map((o) => `${o.name}${o.status === "partial" ? " (part paid)" : ""}`).join(", ") : "All paid"}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="card flex flex-col gap-[18px] p-5 lg:p-6">
              <h2 className="text-[17px] font-semibold">Spend by category</h2>
              {slices.length === 0 ? (
                <p className="text-[15px] text-muted-ink">No spending yet.</p>
              ) : (
                <div className="flex flex-col items-center gap-6 sm:flex-row sm:gap-9">
                  <DonutChart data={slices} total={totals.spent} />
                  <ul className="flex w-full flex-1 flex-col gap-2.5 text-sm">
                    {slices.map((s) => (
                      <li key={s.name} className="flex items-center gap-2.5">
                        <span aria-hidden className="size-3 shrink-0 rounded-[3px]" style={{ background: s.color }} />
                        <span className="flex-1">{s.name}</span>
                        <span className="font-semibold">{formatAmount(s.value)}</span>
                        <span className="w-11 text-right text-muted-ink">{totals.spent ? Math.round((s.value / totals.spent) * 100) : 0}%</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <section className="card flex flex-col gap-[18px] p-5 lg:p-6">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[17px] font-semibold">Weekly spend</h2>
                <span className="text-[13px] text-muted-ink">Dashed line = even pace ({formatMoney(weekPace, currency)} / wk)</span>
              </div>
              {totals.spent === 0 ? (
                <p className="text-[15px] text-muted-ink">No spending yet.</p>
              ) : (
              <ColumnChart
                ariaLabel="Weekly spend"
                height={260}
                reference={{ value: weekPace, label: "Even pace" }}
                data={data.weeks.map((w) => ({
                  label: w.label,
                  value: w.total,
                  muted: w.days < 7,
                  detail: w.days < 7 ? `${w.days} days · pace ${formatAmount(Math.round(data.evenPacePerDay * w.days))}` : undefined,
                }))}
              />
              )}
            </section>
          </div>

          <section className="card flex flex-col gap-3 p-5 lg:px-6">
            <h2 className="text-[17px] font-semibold">Budget vs actual</h2>
            {data.summaries.length === 0 && (
              <p className="text-[15px] text-muted-ink">
                No categories yet.{" "}
                <Link href={`/setup?month=${data.ym}`} className="font-semibold text-teal underline">
                  Set up {formatMonth(data.ym, { month: "long" })}
                </Link>
              </p>
            )}
            <div className="grid gap-x-9 gap-y-3.5 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {data.summaries.map((s) => {
                const pct = s.effectiveAllocation > 0 ? Math.min((s.spent / s.effectiveAllocation) * 100, 100) : s.spent > 0 ? 100 : 0;
                return (
                  <div key={s.categoryId} className="flex flex-col gap-1.5">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{s.name}</span>
                      <span className={cn("font-semibold", TEXT[s.state])}>
                        {s.remaining < 0 ? `${formatAmount(s.remaining)} · cover` : `${formatAmount(s.remaining)} left`}
                      </span>
                    </div>
                    <div
                      role="meter"
                      aria-label={`${s.name} spent`}
                      aria-valuemin={0}
                      aria-valuemax={s.effectiveAllocation}
                      aria-valuenow={s.spent}
                      className="h-2 overflow-hidden rounded-full bg-line-soft"
                    >
                      <div className={cn("h-full rounded-full", BAR[s.state])} style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-muted-ink">
                      {formatAmount(s.spent)} of {formatAmount(s.effectiveAllocation)}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          {data.owed.length > 0 && (
            <section className="card flex flex-col gap-2 p-5 lg:px-6">
              <h2 className="text-[17px] font-semibold">Unpaid & partial monthly items</h2>
              <ul className="divide-y divide-line-soft text-sm">
                {data.owed.map((o) => (
                  <li key={o.itemId} className="flex items-center gap-3 py-2.5">
                    <span className="flex-1">
                      <span className="font-medium">{o.name}</span> <span className="text-muted-ink">· {o.categoryName}</span>
                    </span>
                    <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", o.status === "partial" ? "bg-warn-bg text-warn" : "bg-line-soft text-muted-ink")}>
                      {o.status === "partial" ? `${formatAmount(o.paid)} paid` : "Unpaid"}
                    </span>
                    <span className="w-24 text-right font-semibold">{formatAmount(o.expected - o.paid)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub, valueClass }: { label: string; value: string; sub: React.ReactNode; valueClass?: string }) {
  return (
    <div className="card flex flex-col gap-1.5 px-5 py-[18px]">
      <span className="text-[13px] text-muted-ink">{label}</span>
      <span className={cn("font-display text-2xl font-semibold lg:text-[28px]", valueClass)}>{value}</span>
      <span className="text-[13px] text-muted-ink">{sub}</span>
    </div>
  );
}

function Figure({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[13px] text-muted-ink">{label}</span>
      <span className={cn("font-display text-xl font-semibold", className)}>{value}</span>
    </div>
  );
}
