"use client";

import { useMemo, useState } from "react";
import { inRange, monthOfRange, topItems, type Row } from "@/lib/analysis";
import { formatMonth, type Range } from "@/lib/dates";
import { formatAmount, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Empty, Stat, field, type Data, type Target } from "./parts";

/** What the money went on, biggest first. For a single budget month it also shows planned vs spent. */
export function TopItems({ data, range, onPick }: { data: Data; range: Range; onPick: (t: Target) => void }) {
  const [categoryId, setCategoryId] = useState("");
  const ym = monthOfRange(range, data.startDay);
  const list = useMemo(() => {
    const rows = data.rows.filter((r: Row) => inRange(r.date, range));
    return topItems(rows, data.items, data.categories.filter((c) => !c.archived), ym).filter((t) => !categoryId || t.categoryId === categoryId);
  }, [data, range, ym, categoryId]);
  const total = list.reduce((a, t) => a + t.total, 0);
  const planned = list.reduce((a, t) => a + (t.planned ?? 0), 0);
  const max = Math.max(...list.map((t) => Math.max(t.total, t.planned ?? 0)), 1);

  return (
    <>
      <select aria-label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={cn(field, "self-start")}>
        <option value="">All categories</option>
        {data.categories.filter((c) => !c.archived || data.rows.some((r) => r.categoryId === c.id)).map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>

      <div className={cn("grid grid-cols-2 gap-2.5", ym && "lg:grid-cols-3")}>
        <Stat wide={!!ym} label="Spent" value={formatMoney(total, data.currency)} />
        {ym && <Stat label="Planned" value={formatAmount(planned)} sub={formatMonth(ym, { month: "long" })} />}
        {ym ? (
          <Stat label={total > planned ? "Over plan" : "Under plan"} value={formatAmount(Math.abs(total - planned))} />
        ) : (
          <Stat label="Items" value={String(list.length)} />
        )}
      </div>

      {list.length === 0 ? (
        <Empty>No spending in this range.</Empty>
      ) : (
        <section className="card flex flex-col divide-y divide-line-soft px-2">
          {list.map((t, i) => {
            const gap = t.planned == null ? null : t.total - t.planned;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => onPick(t.name == null && t.categoryId ? { kind: "category", id: t.categoryId } : { kind: "item", key: t.key })}
                className="flex flex-col gap-1.5 rounded-lg px-2 py-3 text-left hover:bg-paper"
              >
                <span className="flex items-start gap-2.5">
                  <span className="w-5 pt-0.5 text-right text-xs text-faint">{i + 1}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px] font-semibold">{t.name ?? (t.categoryId ? `${t.categoryName} · no item` : "Needs category")}</span>
                    <span className="truncate text-xs text-muted-ink">
                      {[
                        t.name == null ? null : t.categoryName,
                        t.count ? `${t.count} entr${t.count === 1 ? "y" : "ies"}` : null,
                        t.planned != null ? `planned ${formatAmount(t.planned)}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="flex flex-col items-end">
                    <span className="text-[15px] font-semibold">{formatAmount(t.total)}</span>
                    {gap != null && gap !== 0 ? (
                      <span className={cn("text-xs font-medium", gap > 0 ? "text-bad" : "text-ok")}>
                        {formatAmount(Math.abs(gap))} {gap > 0 ? "over" : t.total === 0 ? "not spent" : "under"}
                      </span>
                    ) : gap === 0 ? (
                      <span className="text-xs text-muted-ink">as planned</span>
                    ) : (
                      <span className="text-xs text-muted-ink">{Math.round(t.share * 100)}%</span>
                    )}
                  </span>
                </span>
                {/* Spent bar; the tick marks the planned amount when there is one. */}
                <span className="relative ml-7 block h-1.5 rounded-full bg-line-soft">
                  <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(t.total / max) * 100}%`, background: t.color }} />
                  {t.planned != null && t.planned > 0 && (
                    <span aria-hidden className="absolute -top-1 h-3.5 w-0.5 rounded bg-ink" style={{ left: `${(t.planned / max) * 100}%` }} />
                  )}
                </span>
              </button>
            );
          })}
        </section>
      )}
      {ym ? (
        <p className="text-xs text-muted-ink">
          Planned is each item&apos;s amount in Setup. A monthly item has one amount for every month, so earlier months are compared with today&apos;s amount.
        </p>
      ) : (
        <p className="text-xs text-muted-ink">Pick This month or Last month to compare with what was planned.</p>
      )}
    </>
  );
}
