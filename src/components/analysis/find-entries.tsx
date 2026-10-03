"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { searchRows } from "@/lib/analysis";
import { formatDay, type Range } from "@/lib/dates";
import { formatAmount, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Empty, field, type Data } from "./parts";

const LIMIT = 200;

/** Search entries by text, category and account; each row opens its day, where it can be edited. */
export function FindEntries({ data, range }: { data: Data; range: Range }) {
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");
  const found = useMemo(
    () => searchRows(data.rows, { q, categoryId: categoryId || null, accountId: accountId || null, range }),
    [data.rows, q, categoryId, accountId, range],
  );
  const accountName = useMemo(() => new Map(data.accounts.map((a) => [a.id, a.name])), [data.accounts]);
  const total = found.reduce((a, r) => a + r.amount, 0);

  return (
    <>
      <div className="flex flex-col gap-2">
        <label className="flex min-h-[52px] items-center gap-2.5 rounded-[14px] border border-line-strong bg-surface px-3.5 focus-within:border-teal">
          <Search aria-hidden className="size-[18px] text-muted-ink" />
          <span className="sr-only">Search notes, items and categories</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search notes, items, categories"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-faint"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <select aria-label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={cn(field, "min-w-0")}>
            <option value="">All categories</option>
            {data.categories.filter((c) => !c.archived || data.rows.some((r) => r.categoryId === c.id)).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <select aria-label="Account" value={accountId} onChange={(e) => setAccountId(e.target.value)} className={cn(field, "min-w-0")}>
            <option value="">All accounts</option>
            {data.accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
            <option value="none">Not deducted</option>
          </select>
        </div>
      </div>

      <div className="flex items-baseline justify-between gap-3 px-1">
        <span className="text-sm text-muted-ink">
          {found.length} entr{found.length === 1 ? "y" : "ies"}
        </span>
        <span className="font-display text-xl font-semibold">{formatMoney(total, data.currency)}</span>
      </div>

      {found.length === 0 ? (
        <Empty>Nothing matches. Try a longer range or fewer filters.</Empty>
      ) : (
        <section className="card flex flex-col divide-y divide-line-soft px-4">
          {found.slice(0, LIMIT).map((r) => (
            <Link key={r.id} href={`/day/${r.date}`} className="flex items-center gap-2.5 py-3">
              <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: r.color ?? "var(--faint)" }} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[15px] font-medium">{r.itemName ?? r.note ?? r.categoryName ?? "Needs category"}</span>
                <span className="truncate text-xs text-muted-ink">
                  {[formatDay(r.date), r.categoryName ?? "Needs category", r.itemName ? r.note : null, r.accountId ? accountName.get(r.accountId) : "not deducted"]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span className="text-[15px] font-semibold">{formatAmount(r.amount)}</span>
              <ChevronRight aria-hidden className="size-4 text-faint" />
            </Link>
          ))}
        </section>
      )}
      {found.length > LIMIT && <p className="text-xs text-muted-ink">Showing the newest {LIMIT}. The total covers all {found.length}.</p>}
    </>
  );
}
