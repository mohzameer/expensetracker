"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { BarChart3, Check, ChevronDown, ChevronLeft, ChevronRight, Lock, Plus } from "lucide-react";
import { ExpenseSheet, type ExpensePayload, type ExpenseSheetMode } from "@/components/sheets/expense-sheet";
import { CoverSheet } from "@/components/sheets/cover-sheet";
import { createExpenseAction, deleteExpenseAction, updateExpenseAction } from "@/server/actions";
import type { CategorySummary, DayView as DayData, DueItem, ExpenseRow } from "@/server/queries";
import { stateAfter } from "@/lib/budget";
import { addDays, formatDay, formatMonth, relativeDay } from "@/lib/dates";
import { formatAmount, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type OptimisticOp = { type: "add"; row: ExpenseRow } | { type: "update"; row: ExpenseRow } | { type: "remove"; id: string };

export function DayView({ data }: { data: DayData }) {
  const router = useRouter();
  const closed = data.month?.status === "closed";
  const [, startTransition] = useTransition();
  const [expenses, applyOptimistic] = useOptimistic(data.expenses, (state: ExpenseRow[], op: OptimisticOp) => {
    if (op.type === "add") return [...state, op.row];
    if (op.type === "update") return op.row.spentOn === data.date ? state.map((e) => (e.id === op.row.id ? op.row : e)) : state.filter((e) => e.id !== op.row.id);
    return state.filter((e) => e.id !== op.id);
  });

  const [sheet, setSheet] = useState<{ open: boolean; key: number; mode: ExpenseSheetMode }>({ open: false, key: 0, mode: { kind: "add" } });
  const [cover, setCover] = useState<{ open: boolean; key: number; categoryId: string | null }>({ open: false, key: 0, categoryId: null });

  const openSheet = (mode: ExpenseSheetMode) => setSheet((s) => ({ open: true, key: s.key + 1, mode }));
  const openCover = (categoryId: string) => setCover((c) => ({ open: true, key: c.key + 1, categoryId }));
  const summaryOf = (id: string | null) => (id ? data.summaries.find((s) => s.categoryId === id) : undefined);

  const toRow = (p: ExpensePayload, id: string): ExpenseRow => {
    const cat = data.catalog.categories.find((c) => c.id === p.categoryId);
    const item = data.catalog.items.find((i) => i.id === p.itemId);
    return {
      id,
      spentOn: p.spentOn,
      amount: p.amount,
      note: p.note,
      categoryId: p.categoryId,
      categoryName: cat?.name ?? null,
      color: cat?.color ?? null,
      itemId: p.itemId,
      itemName: item?.name ?? null,
      itemKind: item?.kind ?? null,
      accountId: p.accountId,
    };
  };

  const onSubmit = (payload: ExpensePayload, id?: string) => {
    setSheet((s) => ({ ...s, open: false }));
    startTransition(async () => {
      if (id) applyOptimistic({ type: "update", row: toRow(payload, id) });
      else if (payload.spentOn === data.date) applyOptimistic({ type: "add", row: toRow(payload, `pending-${Date.now()}`) });
      const res = id
        ? await updateExpenseAction({ id, expense: payload })
        : await createExpenseAction(payload);
      if (!res.ok) return void toast.error(res.error);
      const c = res.data.category;
      if (!c) {
        toast.success(payload.categoryId ? "Saved" : "Saved to Needs category");
      } else if (c.state === "red") {
        toast.error(`Saved · ${c.name} is over by ${formatMoney(-c.remaining, data.currency)}`, {
          action: payload.spentOn.startsWith(data.ym) ? { label: "Cover", onClick: () => openCover(payload.categoryId!) } : undefined,
        });
      } else if (c.state === "amber") {
        toast.warning(`Saved · only ${formatMoney(c.remaining, data.currency)} left in ${c.name}`);
      } else {
        toast.success(`Saved · ${formatMoney(c.remaining, data.currency)} left in ${c.name}`);
      }
    });
  };

  const onDelete = (id: string) => {
    setSheet((s) => ({ ...s, open: false }));
    startTransition(async () => {
      applyOptimistic({ type: "remove", id });
      const res = await deleteExpenseAction(id);
      if (!res.ok) toast.error(res.error);
      else toast("Expense deleted");
    });
  };

  const due = data.monthly.filter((m) => m.status !== "paid");
  const paid = data.monthly.filter((m) => m.status === "paid");
  const coverTarget = summaryOf(cover.categoryId);
  const isToday = data.date === data.today;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col lg:max-w-5xl lg:px-8 lg:py-6">
      <header className="flex flex-col gap-3.5 px-4 pt-5 pb-3 lg:px-0">
        <div className="flex items-center justify-between lg:justify-start lg:gap-4">
          <Link
            href={`/day/${addDays(data.date, -1)}`}
            aria-label="Previous day"
            className="flex size-11 items-center justify-center rounded-full border border-line bg-surface"
          >
            <ChevronLeft className="size-5" />
          </Link>
          <label className="relative flex min-h-11 cursor-pointer flex-col items-center gap-0.5 px-2 lg:order-first lg:items-start lg:px-0">
            <span className="font-display text-[22px] font-semibold lg:text-[30px]">{formatDay(data.date)}</span>
            <span className="text-[13px] text-muted-ink">{relativeDay(data.date, data.today)}</span>
            <input
              type="date"
              aria-label="Jump to date"
              value={data.date}
              onChange={(e) => e.target.value && router.push(`/day/${e.target.value}`)}
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
          <Link
            href={`/day/${addDays(data.date, 1)}`}
            aria-label="Next day"
            className="flex size-11 items-center justify-center rounded-full border border-line bg-surface"
          >
            <ChevronRight className="size-5" />
          </Link>
          <div className="hidden flex-1 lg:block" />
          {!isToday && (
            <Link href={`/day/${data.today}`} className="hidden min-h-11 items-center rounded-xl border border-line bg-surface px-4 text-sm font-semibold lg:flex">
              Today
            </Link>
          )}
          {!closed && (
            <button
              onClick={() => openSheet({ kind: "add" })}
              className="hidden min-h-11 items-center gap-1.5 rounded-xl bg-ink px-[18px] text-[15px] font-semibold text-white lg:flex"
            >
              <Plus className="size-4" /> Add expense
            </button>
          )}
        </div>

        {closed ? (
          <div className="flex items-center gap-3 rounded-2xl bg-lock-bg px-4 py-3.5 text-ink-soft">
            <Lock aria-hidden className="size-[22px] shrink-0" />
            <div className="flex flex-col gap-0.5">
              <span className="text-[15px] font-semibold">{formatMonth(data.ym, { month: "long" })} is closed</span>
              <span className="text-[13px]">
                Read-only.{" "}
                {data.summaries.some((s) => s.swept > 0) &&
                  `${formatMoney(data.summaries.reduce((a, s) => a + s.swept, 0), data.currency)} went to Savings.`}
              </span>
            </div>
          </div>
        ) : (
          <Link
            href={`/charts?from=${encodeURIComponent(`/day/${data.date}`)}`}
            aria-label="Open spending charts"
            className="relative flex items-end justify-between rounded-[18px] bg-teal px-[18px] py-4 text-white active:opacity-90"
          >
            <div className="flex flex-col gap-1">
              <span className="text-[13px] opacity-85">Spent {isToday ? "today" : "this day"}</span>
              <span className="font-display text-[30px] leading-tight font-semibold">{formatMoney(data.totals.spentToday, data.currency)}</span>
            </div>
            {data.month && (
              <div className="flex flex-col items-end gap-1">
                <span className="text-[13px] opacity-85">Left in {formatMonth(data.ym, { month: "short" })}</span>
                <span className="text-[17px] font-semibold">{formatMoney(data.totals.left, data.currency)}</span>
                <span className="text-xs opacity-85">of {formatMoney(data.totals.allocated, data.currency)} allocated</span>
              </div>
            )}
            {/* Faint hint, top centre (always clear of the figures), that the bar opens the charts. */}
            <BarChart3
              aria-hidden
              className="pointer-events-none absolute top-3.5 left-1/2 size-5 -translate-x-1/2 opacity-30"
            />
          </Link>
        )}

        {data.inboxCount > 0 && (
          <Link href="/inbox" className="flex min-h-11 items-center gap-2.5 rounded-xl border border-line bg-surface px-3.5">
            <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-ink px-1.5 text-xs font-semibold text-white">
              {data.inboxCount}
            </span>
            <span className="flex-1 text-[15px] font-medium">Needs category</span>
            <ChevronRight aria-hidden className="size-[18px] text-muted-ink" />
          </Link>
        )}
      </header>

      <main className="flex flex-1 flex-col gap-[18px] px-4 pt-1 pb-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6 lg:px-0">
        {!closed && (due.length > 0 || paid.length > 0) && (
          <div className="flex flex-col gap-[18px] lg:order-2">
            {due.length > 0 && (
              <FoldSection
                id="due-list"
                title={`Due this month · ${due.length}`}
                summary={formatMoney(due.reduce((a, d) => a + d.expected - d.paid, 0), data.currency)}
              >
                {due.map((d) => (
                  <DueRow
                    key={d.itemId}
                    item={d}
                    onLog={() => openSheet({ kind: "add", prefill: { categoryId: d.categoryId, itemId: d.itemId, amount: d.expected - d.paid } })}
                  />
                ))}
              </FoldSection>
            )}
            {paid.length > 0 && (
              <FoldSection
                id="paid-list"
                title={`Paid this month · ${paid.length}`}
                summary={formatMoney(paid.reduce((a, d) => a + d.paid, 0), data.currency)}
              >
                {paid.map((d) => (
                  <PaidRow key={d.itemId} item={d} />
                ))}
              </FoldSection>
            )}
          </div>
        )}

        <section className="flex flex-col gap-2 lg:order-1">
          <h2 className="eyebrow flex justify-between">
            <span>
              {isToday ? "Today" : formatDay(data.date, { day: "numeric", month: "short" })} · {expenses.length}{" "}
              {expenses.length === 1 ? "entry" : "entries"}
            </span>
            {closed && <span>{formatMoney(data.totals.spentToday, data.currency)}</span>}
          </h2>
          {expenses.length === 0 ? (
            <div className="card px-4 py-8 text-center text-[15px] text-muted-ink">
              {closed ? "Nothing was logged this day." : "Nothing logged yet."}
            </div>
          ) : (
            <ul className={cn("card flex flex-col divide-y divide-line-soft", closed && "opacity-85")}>
              {expenses.map((e) => (
                <EntryRow
                  key={e.id}
                  expense={e}
                  summary={summaryOf(e.categoryId)}
                  currency={data.currency}
                  readOnly={closed}
                  pending={e.id.startsWith("pending-")}
                  onEdit={() => openSheet({ kind: "edit", expense: e })}
                  onCover={() => e.categoryId && openCover(e.categoryId)}
                />
              ))}
            </ul>
          )}
        </section>
      </main>

      <div className="sticky bottom-0 border-t border-line bg-paper px-4 pt-3 pb-[max(28px,env(safe-area-inset-bottom))] lg:hidden">
        {closed ? (
          <Link
            href={`/day/${data.today}`}
            className="flex min-h-14 w-full items-center justify-center rounded-2xl border border-ink text-base font-semibold"
          >
            Jump to today
          </Link>
        ) : (
          <button
            onClick={() => openSheet({ kind: "add" })}
            className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-ink text-[17px] font-semibold text-white"
          >
            <Plus aria-hidden className="size-5" strokeWidth={2.2} /> Add expense
          </button>
        )}
      </div>

      {!closed && (
        <ExpenseSheet
          key={sheet.key}
          open={sheet.open}
          onOpenChange={(open) => setSheet((s) => ({ ...s, open }))}
          mode={sheet.mode}
          date={data.date}
          data={data}
          onSubmit={onSubmit}
          onDelete={onDelete}
        />
      )}
      {!closed && coverTarget && (
        <CoverSheet
          key={`cover-${cover.key}`}
          open={cover.open}
          onOpenChange={(open) => setCover((c) => ({ ...c, open }))}
          target={coverTarget}
          summaries={data.summaries}
          savings={data.savings}
          currency={data.currency}
          ym={data.ym}
        />
      )}
    </div>
  );
}

/** Folded to one row on phones (count + total), always open on desktop. */
function FoldSection({ id, title, summary, children }: { id: string; title: string; summary: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="flex flex-col gap-2">
      <h2 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "flex w-full items-center gap-2 text-left lg:pointer-events-none",
            !open && "card min-h-12 px-3.5 lg:min-h-0 lg:rounded-none lg:border-0 lg:bg-transparent lg:px-0",
          )}
        >
          <span className="eyebrow flex-1">{title}</span>
          <span className={cn("text-sm font-semibold", open && "hidden", "lg:hidden")}>{summary}</span>
          <ChevronDown aria-hidden className={cn("size-[18px] text-muted-ink transition-transform lg:hidden", open && "rotate-180")} />
        </button>
      </h2>
      <ul id={id} className={cn("card flex-col divide-y divide-line-soft", open ? "flex" : "hidden lg:flex")}>
        {children}
      </ul>
    </section>
  );
}

function PaidRow({ item }: { item: DueItem }) {
  const over = item.paid - item.expected;
  return (
    <li className="flex items-center gap-3 py-2.5 pr-3.5 pl-3.5">
      <span aria-label="Paid" className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-ok">
        <Check aria-hidden className="size-3 text-white" strokeWidth={3} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[15px] font-medium">{item.name}</span>
        <span className="truncate text-xs text-muted-ink">{item.categoryName}</span>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <span className="text-[15px] font-medium">{formatAmount(item.paid)}</span>
        {over > 0 && <span className="text-[11px] font-semibold text-warn">paid +{formatAmount(over)}</span>}
      </div>
    </li>
  );
}

function DueRow({ item, onLog }: { item: DueItem; onLog: () => void }) {
  const owed = item.expected - item.paid;
  return (
    <li className="flex items-center gap-3 py-2.5 pr-3 pl-3.5">
      {item.status === "partial" ? (
        <span
          aria-label="Part paid"
          className="size-[18px] shrink-0 rounded-full border-2 border-teal"
          style={{ background: `conic-gradient(var(--teal) 0 ${Math.round((item.paid / item.expected) * 100)}%, transparent 0)` }}
        />
      ) : (
        <span aria-label="Unpaid" className="size-[18px] shrink-0 rounded-full border-2 border-dashed border-faint" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[15px] font-medium">{item.name}</span>
        <span className="truncate text-xs text-muted-ink">
          {item.categoryName} · {item.status === "partial" ? `${formatAmount(item.paid)} paid` : "monthly"}
        </span>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <span className="text-[15px] font-medium">{formatAmount(owed)}</span>
        {item.status === "partial" && <span className="text-[11px] text-muted-ink">of {formatAmount(item.expected)}</span>}
      </div>
      <button
        onClick={onLog}
        className="min-h-9 rounded-full border border-teal px-3.5 text-sm font-semibold text-teal hover:bg-teal-wash"
      >
        Log
      </button>
    </li>
  );
}

function EntryRow({
  expense: e,
  summary,
  currency,
  readOnly,
  pending,
  onEdit,
  onCover,
}: {
  expense: ExpenseRow;
  summary?: CategorySummary;
  currency: string;
  readOnly: boolean;
  pending: boolean;
  onEdit: () => void;
  onCover: () => void;
}) {
  const title = e.itemName ?? e.note ?? e.categoryName ?? "Unlabelled";
  const subtitle = [e.categoryName, e.itemName && e.note ? e.note : null, e.accountId ? null : "not deducted"].filter(Boolean).join(" · ");
  const state = summary ? stateAfter(summary, 0).state : null;

  const body = (
    <>
      <div className="flex min-w-0 flex-1 flex-col gap-[3px] text-left">
        <span className="truncate text-[15px] font-medium">{title}</span>
        {e.categoryId ? (
          <span className="truncate text-xs text-muted-ink">{subtitle}</span>
        ) : (
          <span className="text-xs font-semibold text-warn">Needs category</span>
        )}
      </div>
      <span className="text-[15px] font-semibold">{formatAmount(e.amount)}</span>
    </>
  );

  return (
    <li className={cn("flex flex-col", pending && "opacity-60")}>
      {readOnly ? (
        <div className="flex items-center gap-3 px-3.5 py-3">{body}</div>
      ) : (
        <button onClick={onEdit} disabled={pending} className="flex items-start gap-3 px-3.5 pt-3 pb-3 text-left hover:bg-paper/60">
          {body}
        </button>
      )}
      {!readOnly && summary && state && (
        <div className="-mt-1.5 flex items-center gap-2 px-3.5 pb-3">
          {state === "red" ? (
            <>
              <span className="text-xs font-semibold text-bad">
                {summary.name} at {formatMoney(summary.remaining, currency)}
              </span>
              <button onClick={onCover} className="flex min-h-7 items-center rounded-full bg-bad-bg px-2.5 text-xs font-semibold text-bad">
                Cover
              </button>
            </>
          ) : state === "amber" ? (
            <span className="text-xs font-semibold text-warn">
              {summary.remaining === 0 ? `${summary.name} fully used` : `Only ${formatMoney(summary.remaining, currency)} left`}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs font-semibold text-ok">
              <Check aria-hidden className="size-3" strokeWidth={3} />
              {formatMoney(summary.remaining, currency)} left
            </span>
          )}
        </div>
      )}
    </li>
  );
}
