"use client";

import { useMemo } from "react";
import { ColumnChart } from "@/components/charts/column-chart";
import { monthBuckets, type Row } from "@/lib/analysis";
import { formatMonth, formatRange, periodEnd, periodStart } from "@/lib/dates";
import { formatAmount, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Empty, Stat, type Data } from "./parts";

/** The picked item or category across the last 12 budget months. */
export function Months({ data, rows }: { data: Data; rows: Row[] }) {
  const { months, average } = useMemo(() => monthBuckets(rows, data.today, data.startDay), [rows, data.today, data.startDay]);
  const withSpend = months.filter((m) => m.total > 0);
  const highest = withSpend.reduce((a, m) => (m.total > a.total ? m : a), withSpend[0]);
  if (!withSpend.length) return <Empty>No spending here in the last 12 months.</Empty>;

  return (
    <>
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
        <Stat wide label="Last 12 months" value={formatMoney(months.reduce((a, m) => a + m.total, 0), data.currency)} />
        <Stat label="Average / month" value={average == null ? "—" : formatAmount(average)} sub={average == null ? "needs a finished month" : "finished months"} />
        <Stat label="Highest" value={formatAmount(highest.total)} sub={formatMonth(highest.ym)} />
      </div>
      <section className="card flex flex-col gap-2 p-4">
        <ColumnChart
          ariaLabel="Spending by budget month"
          data={months.map((m) => ({ label: m.label, value: m.total, muted: m.current, detail: formatMonth(m.ym) }))}
          labels={false}
          reference={average == null ? undefined : { value: average, label: "Average" }}
          tickInterval={0}
        />
        <p className="text-xs text-muted-ink">
          {average != null && `Dashed line — average of finished months (${formatAmount(average)}). `}Grey bar — this month so far.
        </p>
      </section>
      <section className="card flex flex-col divide-y divide-line-soft px-4">
        {[...months].reverse().filter((m) => m.total > 0 || m.current).map((m) => {
          const diff = average == null || m.current ? null : m.total - average;
          return (
            <div key={m.ym} className="flex items-center gap-3 py-3">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-[15px] font-semibold">
                  {formatMonth(m.ym)}
                  {m.current && <span className="font-normal text-muted-ink"> · so far</span>}
                </span>
                <span className="text-xs text-muted-ink">
                  {data.startDay === 1 ? "" : `${formatRange(periodStart(m.ym, data.startDay), periodEnd(m.ym, data.startDay))} · `}
                  {m.count} entr{m.count === 1 ? "y" : "ies"}
                </span>
              </div>
              <div className="flex flex-col items-end">
                <span className="text-[15px] font-semibold">{formatAmount(m.total)}</span>
                {diff != null && diff !== 0 && (
                  <span className={cn("text-xs", diff > 0 ? "text-bad" : "text-ok")}>
                    {formatAmount(Math.abs(diff))} {diff > 0 ? "above" : "below"} average
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </section>
    </>
  );
}
