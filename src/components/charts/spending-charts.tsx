"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight, Search, X } from "lucide-react";
import { ColumnChart } from "./column-chart";
import { ChartFilter } from "./chart-filter";
import type { getSpending } from "@/server/queries";
import { addDays, addMonths, formatDay, formatMonth, formatRange, periodEnd, periodOf, periodStart, weekStart } from "@/lib/dates";
import { formatAmount, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type Data = Awaited<ReturnType<typeof getSpending>>;
type Period = "daily" | "weekly" | "monthly";
type Bucket = { key: string; label: string; detail: string; from: string; to: string };

const PERIODS: { id: Period; label: string; unit: string }[] = [
  { id: "daily", label: "Daily", unit: "day" },
  { id: "weekly", label: "Weekly", unit: "week" },
  { id: "monthly", label: "Monthly", unit: "month" },
];

const short = (d: string) => formatDay(d, { day: "numeric", month: "short" });

function buckets(period: Period, today: string, startDay: number): Bucket[] {
  if (period === "daily") {
    return Array.from({ length: 30 }, (_, i) => {
      const d = addDays(today, i - 29);
      return { key: d, label: String(Number(d.slice(8))), detail: formatDay(d), from: d, to: d };
    });
  }
  if (period === "weekly") {
    const start = weekStart(today);
    return Array.from({ length: 12 }, (_, i) => {
      const from = addDays(start, (i - 11) * 7);
      const to = addDays(from, 6);
      return { key: from, label: short(from), detail: `${short(from)} – ${short(to)}`, from, to };
    });
  }
  // Budget months (e.g. "September" = 25 Sep → 24 Oct when months start on the 25th).
  const cur = periodOf(today, startDay);
  return Array.from({ length: 12 }, (_, i) => {
    const ym = addMonths(cur, i - 11);
    const from = periodStart(ym, startDay);
    const end = periodEnd(ym, startDay);
    return {
      key: ym,
      // Three letters ("Sep", not "Sept") so twelve labels fit on a phone.
      label: formatMonth(ym, { month: "short" }).slice(0, 3),
      detail: startDay === 1 ? formatMonth(ym) : `${formatMonth(ym)} · ${formatRange(from, end)}`,
      from,
      to: addDays(end, -1),
    };
  });
}

/** Spending by day, week or month. Opened from the day view's banner; the X goes back. */
export function SpendingCharts({ data, back }: { data: Data; back: string }) {
  const [period, setPeriod] = useState<Period>("daily");
  const [selected, setSelected] = useState<number | null>(null);
  // Categories left out with the Filter button (saved to the account; applied here at once).
  const [hidden, setHidden] = useState<string[]>(data.hidden);

  const series = useMemo(() => {
    return buckets(period, data.today, data.startDay).map((b) => {
      const rows = data.rows.filter((r) => r.date >= b.from && r.date <= b.to && !(r.categoryId && hidden.includes(r.categoryId)));
      const byCat = new Map<string, { name: string; color: string; total: number }>();
      for (const r of rows) {
        const k = r.categoryId ?? "none";
        const cur = byCat.get(k) ?? { name: r.name, color: r.color, total: 0 };
        cur.total += r.total;
        byCat.set(k, cur);
      }
      return {
        ...b,
        total: rows.reduce((a, r) => a + r.total, 0),
        categories: [...byCat.values()].sort((a, c) => c.total - a.total),
      };
    });
  }, [period, data, hidden]);

  const idx = selected ?? series.length - 1; // the latest day/week/month by default
  const sel = series[idx];
  const unit = PERIODS.find((p) => p.id === period)!.unit;
  const total = series.reduce((a, s) => a + s.total, 0);
  const avg = Math.round(total / series.length);
  const highest = series.reduce((a, s) => (s.total > a.total ? s : a), series[0]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[640px] flex-col gap-4 px-4 pt-5 pb-10 lg:max-w-4xl lg:pt-7">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-display text-[26px] font-semibold">Spending</h1>
        <div className="flex-1" />
        <ChartFilter categories={data.filterCategories} hidden={hidden} onPreview={setHidden} />
        <Link href={back} aria-label="Close charts" className="flex size-11 items-center justify-center rounded-full border border-line bg-surface">
          <X className="size-5" />
        </Link>
      </div>

      {/* The phone's way into Analysis (desktop has it in the sidebar). */}
      <Link
        href={`/analysis?from=${encodeURIComponent(`/charts?from=${encodeURIComponent(back)}`)}`}
        className="flex min-h-11 items-center gap-2.5 rounded-xl border border-line bg-surface px-3.5 lg:hidden"
      >
        <Search aria-hidden className="size-[18px] text-muted-ink" />
        <span className="flex-1 text-[15px] font-medium">Analyse an item or category</span>
        <ChevronRight aria-hidden className="size-[18px] text-muted-ink" />
      </Link>

      <div role="tablist" aria-label="Period" className="grid grid-cols-3 gap-1 rounded-xl bg-line-soft p-1">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={period === p.id}
            onClick={() => {
              setPeriod(p.id);
              setSelected(null);
            }}
            className={cn("min-h-10 rounded-[10px] text-[15px] font-semibold", period === p.id ? "bg-surface shadow-sm" : "text-muted-ink")}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        <Stat label={`Last ${series.length} ${unit}s`} value={formatAmount(total)} />
        <Stat label={`Average / ${unit}`} value={formatAmount(avg)} />
        <Stat label="Highest" value={formatAmount(highest?.total ?? 0)} sub={highest?.total ? highest.detail : undefined} />
      </div>

      <section className="card flex flex-col gap-2 p-4">
        <ColumnChart
          ariaLabel={`${PERIODS.find((p) => p.id === period)!.label} spending`}
          height={260}
          labels={period !== "daily"}
          tickInterval={period === "daily" ? 4 : period === "weekly" ? 1 : 0}
          reference={avg ? { value: avg, label: "Average" } : undefined}
          selected={idx}
          onSelect={setSelected}
          data={series.map((s) => ({ label: s.label, value: s.total, detail: s.detail }))}
        />
        <p className="text-center text-xs text-muted-ink">Dashed line = average · tap a bar to see its categories</p>
      </section>

      <section className="card flex flex-col gap-3 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[17px] font-semibold">{sel.detail}</h2>
          <span className="font-semibold">{formatMoney(sel.total, data.currency)}</span>
        </div>
        {sel.categories.length === 0 ? (
          <p className="text-[15px] text-muted-ink">Nothing spent.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {sel.categories.map((c) => (
              <li key={c.name} className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-sm">
                  <span aria-hidden className="size-2.5 rounded-full" style={{ background: c.color }} />
                  <span className="flex-1">{c.name}</span>
                  <span className="font-semibold">{formatAmount(c.total)}</span>
                  <span className="w-10 text-right text-muted-ink">{sel.total ? Math.round((c.total / sel.total) * 100) : 0}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-line-soft">
                  <div className="h-full rounded-full" style={{ width: `${sel.total ? (c.total / sel.total) * 100 : 0}%`, background: c.color }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card flex flex-col gap-0.5 px-3 py-3">
      <span className="text-xs text-muted-ink">{label}</span>
      <span className="text-[17px] font-semibold">{value}</span>
      {sub && <span className="truncate text-[11px] text-muted-ink">{sub}</span>}
    </div>
  );
}
