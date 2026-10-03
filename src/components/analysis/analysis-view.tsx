"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { CreatableCombobox, type ComboOption } from "@/components/combobox";
import { itemKey, rowKey } from "@/lib/analysis";
import { cn } from "@/lib/utils";
import { FindEntries } from "./find-entries";
import { History } from "./history";
import { Months } from "./months";
import { RangeControl, resolveRange, type Data, type RangeState, type Target } from "./parts";
import { TopItems } from "./top-items";

type Tab = "history" | "months" | "top" | "find";
const TABS: { id: Tab; label: string }[] = [
  { id: "history", label: "History" },
  { id: "months", label: "Monthly" },
  { id: "top", label: "Top items" },
  { id: "find", label: "Find" },
];

const valueOf = (t: Target) => (t ? (t.kind === "item" ? `i:${t.key}` : `c:${t.id}`) : null);
const targetOf = (v: string | null): Target =>
  !v ? null : v.startsWith("i:") ? { kind: "item", key: v.slice(2) } : { kind: "category", id: v.slice(2) };

/** Pick an item or category and see where the money went: by day, by month, ranked, or searched. */
export function AnalysisView({ data, back }: { data: Data; back: string }) {
  const [tab, setTab] = useState<Tab>("history");
  const [target, setTarget] = useState<Target>(null);
  const [rangeState, setRangeState] = useState<RangeState>({ preset: "month", from: data.today, to: data.today });
  const range = useMemo(() => resolveRange(rangeState, data.today, data.startDay), [rangeState, data.today, data.startDay]);

  // Everything that can be picked: categories first, then items (by category + name), most spent on first.
  const options = useMemo<ComboOption[]>(() => {
    const spent = new Map<string, number>();
    for (const r of data.rows) spent.set(rowKey(r), (spent.get(rowKey(r)) ?? 0) + r.amount);
    const cats = new Map(data.categories.map((c) => [c.id, c]));
    const usedCats = new Set(data.rows.map((r) => r.categoryId));
    const items = new Map<string, ComboOption>();
    for (const i of data.items) {
      const key = itemKey(i.categoryId, i.name);
      const cat = cats.get(i.categoryId);
      if (!cat || items.has(key) || (i.archived && !spent.has(key))) continue;
      items.set(key, { value: `i:${key}`, label: i.name, color: cat.color, hint: cat.name });
    }
    for (const r of data.rows) {
      const key = rowKey(r);
      if (items.has(key) || !r.categoryId) continue;
      items.set(key, { value: `i:${key}`, label: r.itemName ?? `${r.categoryName} (no item)`, color: r.color ?? undefined, hint: r.categoryName ?? undefined });
    }
    return [
      ...data.categories
        .filter((c) => !c.archived || usedCats.has(c.id))
        .map((c) => ({ value: `c:${c.id}`, label: c.name, color: c.color, hint: "Whole category" })),
      ...[...items.entries()].sort((a, b) => (spent.get(b[0]) ?? 0) - (spent.get(a[0]) ?? 0) || a[1].label.localeCompare(b[1].label)).map(([, o]) => o),
    ];
  }, [data]);

  const rows = useMemo(
    () => (!target ? data.rows : target.kind === "category" ? data.rows.filter((r) => r.categoryId === target.id) : data.rows.filter((r) => rowKey(r) === target.key)),
    [data.rows, target],
  );
  const pick = (t: Target) => {
    setTarget(t);
    setTab("history");
  };
  const usesTarget = tab === "history" || tab === "months";

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[640px] flex-col gap-4 px-4 pt-5 pb-10 lg:max-w-4xl lg:px-9 lg:pt-7">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-display text-[26px] font-semibold">Analysis</h1>
        <Link href={back} aria-label="Close analysis" className="flex size-11 items-center justify-center rounded-full border border-line bg-surface lg:hidden">
          <X className="size-5" />
        </Link>
      </div>

      <div role="tablist" aria-label="View" className="grid grid-cols-4 gap-1 rounded-xl bg-line-soft p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn("min-h-10 rounded-[10px] text-sm font-semibold sm:text-[15px]", tab === t.id ? "bg-surface shadow-sm" : "text-muted-ink")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {usesTarget && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="analysis-target" className="text-[13px] font-semibold text-muted-ink">Item or category</label>
          <CreatableCombobox
            id="analysis-target"
            options={options}
            value={valueOf(target)}
            onChange={(v) => setTarget(targetOf(v))}
            emptyOption={{ label: "Everything" }}
            placeholder="All spending — type to pick an item"
          />
        </div>
      )}
      {tab !== "months" && <RangeControl value={rangeState} onChange={setRangeState} data={data} />}

      {tab === "history" && <History data={data} rows={rows} target={target} range={range} onPick={pick} />}
      {tab === "months" && <Months data={data} rows={rows} />}
      {tab === "top" && <TopItems data={data} range={range} onPick={pick} />}
      {tab === "find" && <FindEntries data={data} range={range} />}
    </div>
  );
}
