"use client";

import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { assignCategoryAction } from "@/server/actions";
import type { getInbox } from "@/server/queries";
import { formatDay, monthOf } from "@/lib/dates";
import { formatAmount, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type InboxData = Awaited<ReturnType<typeof getInbox>>;

export function InboxList({ data }: { data: InboxData }) {
  const [rows, remove] = useOptimistic(data.rows, (state, id: string) => state.filter((r) => r.id !== id));
  const [, start] = useTransition();

  const assign = (id: string, categoryId: string, name: string) =>
    start(async () => {
      remove(id);
      const res = await assignCategoryAction({ id, categoryId });
      if (!res.ok) return void toast.error(res.error);
      const c = res.data;
      toast.success(c ? `Moved to ${name} · ${formatMoney(c.remaining, data.currency)} left` : `Moved to ${name}`);
    });

  if (rows.length === 0) {
    return <div className="card px-4 py-10 text-center text-[15px] text-muted-ink">All sorted. Nothing needs a category.</div>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => (
        <InboxCard key={r.id} row={r} data={data} onAssign={assign} />
      ))}
    </ul>
  );
}

function InboxCard({
  row,
  data,
  onAssign,
}: {
  row: InboxData["rows"][number];
  data: InboxData;
  onAssign: (id: string, categoryId: string, name: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const summaries = data.summariesByMonth[monthOf(row.spentOn)] ?? [];
  const remaining = (id: string) => summaries.find((s) => s.categoryId === id)?.remaining;
  // Most-used categories first; "Other…" reveals the rest.
  const ranked = [...data.catalog.categories].sort(
    (a, b) => (summaries.find((s) => s.categoryId === b.id)?.spent ?? 0) - (summaries.find((s) => s.categoryId === a.id)?.spent ?? 0),
  );
  const visible = showAll ? ranked : ranked.slice(0, 3);

  return (
    <li className="flex flex-col gap-3.5 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-[3px]">
          <span className="text-base font-semibold">{row.note ?? "Unlabelled"}</span>
          <span className="text-[13px] text-muted-ink">{formatDay(row.spentOn)}</span>
        </div>
        <span className="text-lg font-semibold">{formatMoney(row.amount, data.currency)}</span>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold text-muted-ink">Assign to</span>
        <div className="flex flex-wrap gap-2">
          {visible.map((c) => {
            const rem = remaining(c.id);
            return (
              <button
                key={c.id}
                onClick={() => onAssign(row.id, c.id, c.name)}
                className="flex min-h-10 items-center gap-2 rounded-full border border-line-strong bg-surface px-3.5 text-sm font-medium hover:border-teal"
              >
                <span aria-hidden className="size-2 rounded-full" style={{ background: c.color }} />
                {c.name}
                {rem !== undefined && <span className={cn("text-muted-ink", rem < 0 && "text-bad")}>· {formatAmount(rem)}</span>}
              </button>
            );
          })}
          {!showAll && ranked.length > visible.length && (
            <button
              onClick={() => setShowAll(true)}
              className="min-h-10 rounded-full border border-dashed border-faint px-3.5 text-sm font-medium text-teal"
            >
              Other…
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
