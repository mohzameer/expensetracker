"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { BarChart3, ChevronRight } from "lucide-react";
import { ColumnChart } from "@/components/charts/column-chart";
import { groupByDay, inRange, rangeBars, rowKey, type Row } from "@/lib/analysis";
import { formatDay, type Range } from "@/lib/dates";
import { formatAmount, formatMoney } from "@/lib/money";
import { Empty, Stat, type Data, type Target } from "./parts";

const WIDE = "(min-width: 1024px)";
const subscribe = (cb: () => void) => {
  const m = window.matchMedia(WIDE);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

/** Days and amounts for the picked item or category, with an optional chart. */
export function History({
  data,
  rows,
  target,
  range,
  onPick,
}: {
  data: Data;
  /** Already narrowed to the picked item/category. */
  rows: Row[];
  target: Target;
  range: Range;
  onPick: (t: Target) => void;
}) {
  // The chart is optional: on by default on a wide screen, off on a phone, until toggled.
  const wide = useSyncExternalStore(subscribe, () => window.matchMedia(WIDE).matches, () => false);
  const [chartPref, setChartPref] = useState<boolean | null>(null);
  const showChart = chartPref ?? wide;

  const inside = useMemo(() => rows.filter((r) => inRange(r.date, range)), [rows, range]);
  const days = useMemo(() => groupByDay(inside), [inside]);
  const bars = useMemo(() => rangeBars(inside, range, data.today), [inside, range, data.today]);
  const total = inside.reduce((a, r) => a + r.amount, 0);
  const accountName = useMemo(() => new Map(data.accounts.map((a) => [a.id, a.name])), [data.accounts]);

  // A category (or everything) splits into its items; tap one to drill in.
  const split = useMemo(() => {
    if (target?.kind === "item") return [];
    const by = new Map<string, { key: string; label: string; color: string; total: number }>();
    for (const r of inside) {
      const key = target ? rowKey(r) : (r.categoryId ?? "none");
      const label = target ? (r.itemName ?? "No item") : (r.categoryName ?? "Needs category");
      const cur = by.get(key) ?? { key, label, color: r.color ?? "var(--faint)", total: 0 };
      cur.total += r.amount;
      by.set(key, cur);
    }
    return [...by.values()].sort((a, b) => b.total - a.total);
  }, [inside, target]);

  return (
    <>
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
        <Stat wide label="Total" value={formatMoney(total, data.currency)} />
        <Stat label="Entries" value={String(inside.length)} sub={`on ${days.length} day${days.length === 1 ? "" : "s"}`} />
        <Stat label="Average per day" value={formatAmount(days.length ? Math.round(total / days.length / 100) * 100 : 0)} />
      </div>

      <section className="card flex flex-col gap-2 p-4">
        <button
          type="button"
          aria-expanded={showChart}
          onClick={() => setChartPref(!showChart)}
          className="flex min-h-9 items-center gap-2 self-start rounded-full text-sm font-semibold text-teal"
        >
          <BarChart3 aria-hidden className="size-4" /> {showChart ? "Hide chart" : "Show chart"}
        </button>
        {showChart &&
          (bars.length ? (
            <ColumnChart
              ariaLabel="Spending over the selected range"
              data={bars}
              height={220}
              labels={bars.length <= 12}
            />
          ) : (
            <p className="text-sm text-muted-ink">Nothing to chart in this range.</p>
          ))}
      </section>

      {split.length > 1 && (
        <section className="card flex flex-col gap-1 p-4">
          <h2 className="pb-1 text-[13px] font-semibold tracking-wider text-muted-ink uppercase">{target ? "By item" : "By category"}</h2>
          {split.map((s) => {
            const canPick = target ? true : s.key !== "none";
            const body = (
              <>
                <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                <span className="min-w-0 flex-1 truncate text-left text-[15px]">{s.label}</span>
                <span className="text-xs text-muted-ink">{total ? Math.round((s.total / total) * 100) : 0}%</span>
                <span className="w-24 text-right text-[15px] font-semibold">{formatAmount(s.total)}</span>
              </>
            );
            return canPick ? (
              <button
                key={s.key}
                type="button"
                onClick={() => onPick(target ? { kind: "item", key: s.key } : { kind: "category", id: s.key })}
                className="flex min-h-10 items-center gap-2.5 rounded-lg px-1 hover:bg-paper"
              >
                {body}
              </button>
            ) : (
              <div key={s.key} className="flex min-h-10 items-center gap-2.5 px-1">{body}</div>
            );
          })}
        </section>
      )}

      {days.length === 0 ? (
        <Empty>No spending here in this range. Try a longer range.</Empty>
      ) : (
        <section className="card flex flex-col divide-y divide-line-soft px-4">
          {days.map((d) => (
            <div key={d.date} className="flex flex-col gap-1 py-3">
              <Link href={`/day/${d.date}`} className="flex items-center gap-2">
                <span className="flex-1 text-[15px] font-semibold">{formatDay(d.date)}</span>
                <span className="text-[15px] font-semibold">{formatAmount(d.total)}</span>
                <ChevronRight aria-hidden className="size-4 text-faint" />
              </Link>
              {d.rows.map((r) => {
                const what = [
                  target?.kind === "item" ? null : (r.itemName ?? (target ? "No item" : null)),
                  target ? null : (r.categoryName ?? "Needs category"),
                  r.note,
                  r.accountId ? accountName.get(r.accountId) : "not deducted",
                ].filter(Boolean);
                return (
                  <div key={r.id} className="flex items-baseline gap-2 pr-6 text-[13px] text-muted-ink">
                    <span className="min-w-0 flex-1 truncate">{what.join(" · ")}</span>
                    {d.rows.length > 1 && <span>{formatAmount(r.amount)}</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </section>
      )}
    </>
  );
}
