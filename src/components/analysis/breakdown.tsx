"use client";

import { Fragment, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cycleGrid, type GridItem } from "@/lib/analysis";
import { addMonths, formatDay, formatMonth, formatRange, periodEnd, periodOf, periodStart } from "@/lib/dates";
import { formatAmount, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Empty, Stat, type Data, type Target } from "./parts";

const short = (d: string) => formatDay(d, { day: "numeric", month: "short" });
const th = "px-3 py-2.5 text-[11px] font-semibold tracking-wider text-muted-ink uppercase whitespace-nowrap";
const num = "px-3 py-2.5 text-right tabular-nums whitespace-nowrap";
/** The first column stays put while the rest scrolls sideways on a phone. */
const sticky = "sticky left-0 z-[1] max-w-[42vw] lg:max-w-none";

/** Planned − spent; only meaningful when something was planned. */
function Left({ planned, spent, bold }: { planned: number | null; spent: number; bold?: boolean }) {
  if (planned == null) return <td className={cn(num, "text-faint")}>—</td>;
  const left = planned - spent;
  return <td className={cn(num, bold && "font-semibold", left < 0 ? "text-bad" : left === 0 ? "text-muted-ink" : "text-ok")}>{formatAmount(left)}</td>;
}

function paidOn(i: GridItem) {
  if (!i.paidOn.length) return "—";
  const shown = i.paidOn.slice(0, 3).map(short).join(", ");
  return i.paidOn.length > 3 ? `${shown} +${i.paidOn.length - 3} more` : shown;
}

/** One budget month as a read-only grid: every item under its category, with dates, planned and spent so far. */
export function Breakdown({ data, onPick }: { data: Data; onPick: (t: Target) => void }) {
  const cur = periodOf(data.today, data.startDay);
  const first = periodOf(data.from, data.startDay);
  const [ym, setYm] = useState(cur);
  const grid = useMemo(() => cycleGrid(data.rows, data.items, data.categories, ym, data.startDay), [data, ym]);
  const range = { from: periodStart(ym, data.startDay), to: periodEnd(ym, data.startDay) };
  const left = grid.planned - grid.spent;
  const navBtn = "flex size-10 items-center justify-center rounded-full border border-line bg-surface disabled:opacity-40";

  return (
    <>
      <div className="flex items-center gap-2.5">
        <button type="button" aria-label="Previous month" disabled={ym <= first} onClick={() => setYm(addMonths(ym, -1))} className={navBtn}>
          <ChevronLeft className="size-5" />
        </button>
        <div className="flex min-w-0 flex-1 flex-col lg:flex-none">
          <span className="font-display text-xl font-semibold">{formatMonth(ym)}</span>
          <span className="text-[13px] text-muted-ink">
            {formatRange(range.from, range.to)}
            {ym === cur && ` · as of ${formatDay(data.today)}`}
          </span>
        </div>
        <button type="button" aria-label="Next month" disabled={ym >= cur} onClick={() => setYm(addMonths(ym, 1))} className={navBtn}>
          <ChevronRight className="size-5" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3">
        <Stat wide label={ym === cur ? "Spent so far" : "Spent"} value={formatMoney(grid.spent, data.currency)} />
        <Stat label="Planned" value={formatAmount(grid.planned)} />
        <Stat label={left < 0 ? "Over plan" : "Left of plan"} value={formatAmount(Math.abs(left))} />
      </div>

      {grid.categories.length === 0 ? (
        <Empty>Nothing planned or spent in {formatMonth(ym)}.</Empty>
      ) : (
        <section className="card overflow-x-auto p-0">
          <table className="w-full min-w-[540px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={cn(th, sticky, "bg-surface text-left")}>Item</th>
                <th scope="col" className={cn(th, "text-left")}>Paid on</th>
                <th scope="col" className={cn(th, "text-right")}>Planned</th>
                <th scope="col" className={cn(th, "text-right")}>Spent</th>
                <th scope="col" className={cn(th, "text-right")}>Left</th>
              </tr>
            </thead>
            <tbody>
              {grid.categories.map((c) => (
                <Fragment key={c.id ?? "none"}>
                  <tr className="border-t border-line bg-paper">
                    <th scope="rowgroup" colSpan={2} className={cn(sticky, "bg-paper px-3 py-2.5 text-left")}>
                      <span className="flex items-center gap-2 text-[13px] font-semibold tracking-wide uppercase">
                        <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
                        <span className="truncate">{c.name}</span>
                      </span>
                    </th>
                    {/* Uncategorised spending was never planned, so it has no plan to be over. */}
                    <td className={cn(num, "font-semibold", !c.id && "text-faint")}>{c.id ? formatAmount(c.planned) : "—"}</td>
                    <td className={cn(num, "font-semibold")}>{formatAmount(c.spent)}</td>
                    <Left planned={c.id ? c.planned : null} spent={c.spent} bold />
                  </tr>
                  {c.items.map((i) => (
                    <tr key={i.key} className="border-t border-line-soft">
                      <th scope="row" className={cn(sticky, "bg-surface py-0 pr-3 pl-3 text-left font-normal")}>
                        <button
                          type="button"
                          onClick={() => onPick(i.name == null ? (c.id ? { kind: "category", id: c.id } : null) : { kind: "item", key: i.key })}
                          className="block min-h-10 w-full truncate pl-[18px] text-left text-[15px] hover:text-teal hover:underline"
                        >
                          {i.name ?? (c.id ? "No item" : "Not sorted yet")}
                        </button>
                      </th>
                      <td className="px-3 py-2.5 whitespace-nowrap text-muted-ink">{paidOn(i)}</td>
                      <td className={cn(num, i.planned == null && "text-faint")}>
                        {i.skipped ? <span className="text-xs font-medium text-muted-ink">skipped</span> : i.planned == null ? "—" : formatAmount(i.planned)}
                      </td>
                      <td className={cn(num, i.spent === 0 && "text-faint")}>{formatAmount(i.spent)}</td>
                      <Left planned={i.planned} spent={i.spent} />
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line-strong">
                <th scope="row" colSpan={2} className={cn(sticky, "bg-surface px-3 py-3 text-left text-[13px] font-semibold tracking-wide uppercase")}>
                  Total
                </th>
                <td className={cn(num, "py-3 font-semibold")}>{formatAmount(grid.planned)}</td>
                <td className={cn(num, "py-3 font-semibold")}>{formatAmount(grid.spent)}</td>
                <Left planned={grid.planned} spent={grid.spent} bold />
              </tr>
            </tfoot>
          </table>
        </section>
      )}
      <p className="text-xs text-muted-ink">
        Tap an item for its day-by-day history. Planned is each item&apos;s amount in Setup; for earlier months a monthly item is compared with today&apos;s amount.
        Skipped items were left out of this month in Setup.
      </p>
    </>
  );
}
