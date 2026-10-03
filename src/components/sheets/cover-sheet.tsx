"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Sheet } from "./sheet";
import { moveToCategoryAction } from "@/server/actions";
import type { CategorySummary } from "@/server/queries";
import { formatMonth } from "@/lib/dates";
import { formatAmount, formatMoney, parseMoney, toInputValue } from "@/lib/money";
import { cn } from "@/lib/utils";

type Source =
  | { key: string; kind: "category"; categoryId: string; name: string; available: number }
  | { key: "raise"; kind: "raise"; name: string };

/**
 * Fix an overspent category: take the difference from another category, or
 * raise this category's cap for this month so it fits what was spent.
 */
export function CoverSheet({
  open,
  onOpenChange,
  target,
  summaries,
  currency,
  ym,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: CategorySummary;
  summaries: CategorySummary[];
  currency: string;
  ym: string;
}) {
  const deficit = Math.max(-target.remaining, 0);
  const month = formatMonth(ym, { month: "long" });
  // Raising the cap comes first and is the default; other categories follow, richest first.
  const sources: Source[] = [
    { key: "raise", kind: "raise", name: `Raise ${target.name}'s cap` },
    ...summaries
      .filter((s) => s.categoryId !== target.categoryId && s.remaining > 0)
      .sort((a, b) => b.remaining - a.remaining)
      .map((s) => ({ key: s.categoryId, kind: "category" as const, categoryId: s.categoryId, name: s.name, available: s.remaining })),
  ];
  const [sourceKey, setSourceKey] = useState<string>("raise");
  const [amountStr, setAmountStr] = useState(toInputValue(deficit || null));
  const [pending, start] = useTransition();

  const source = sources.find((s) => s.key === sourceKey)!;
  const amount = parseMoney(amountStr) ?? 0;
  const tooMuch = source.kind === "category" && amount > source.available;

  const submit = () =>
    start(async () => {
      const res = await moveToCategoryAction({
        ym,
        toCategoryId: target.categoryId,
        // Raising the cap takes nothing from another category: the money is simply no longer left over as savings.
        source: source.kind === "raise" ? { kind: "savings" } : { kind: "category", categoryId: source.categoryId },
        amount,
        reason: "cover",
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success(
        source.kind === "raise"
          ? `${target.name}'s cap raised by ${formatMoney(amount, currency)} for ${month}`
          : `Moved ${formatMoney(amount, currency)} from ${source.name} to ${target.name}`,
      );
      onOpenChange(false);
    });

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Cover ${target.name}`}
      description={
        deficit > 0 ? (
          <span className="font-semibold text-bad">
            {target.name} is at {formatMoney(target.remaining, currency)}
          </span>
        ) : (
          <span className="text-muted-ink">Add to {target.name} from another category, or raise its cap.</span>
        )
      }
    >
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="pb-2 text-[13px] font-semibold text-muted-ink">How to cover it</legend>
        <div className="flex max-h-[38dvh] flex-col gap-2 overflow-y-auto">
        {sources.map((s) => {
          const checked = s.key === sourceKey;
          return (
            <label
              key={s.key}
              className={cn(
                "flex min-h-[52px] shrink-0 cursor-pointer items-center gap-3 rounded-xl border px-3.5",
                checked ? "border-[1.5px] border-teal bg-teal-wash" : "border-line",
                s.kind === "raise" && !checked && "bg-[#FAF9F5]",
              )}
            >
              <input type="radio" name="source" checked={checked} onChange={() => setSourceKey(s.key)} className="size-5 accent-teal" />
              {s.kind === "raise" ? (
                <span className="flex flex-1 flex-col py-2">
                  <span className="text-[15px] font-semibold">{s.name}</span>
                  <span className="text-xs text-muted-ink">For {month} only. Comes out of what would be left as savings.</span>
                </span>
              ) : (
                <>
                  <span className="flex-1 text-[15px] font-medium">{s.name}</span>
                  <span className="text-sm text-muted-ink">{formatAmount(s.available)} left</span>
                </>
              )}
            </label>
          );
        })}
        </div>
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="cover-amount" className="text-[13px] font-semibold text-muted-ink">
          Amount
        </label>
        <div className="flex min-h-[52px] items-center gap-2 rounded-xl border border-line-strong px-3.5 focus-within:border-teal">
          <span className="text-muted-ink">{currency}</span>
          <input
            id="cover-amount"
            inputMode="decimal"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value.replace(/[^0-9.,]/g, ""))}
            className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none"
          />
        </div>
        {tooMuch && source.kind === "category" && (
          <p className="text-[13px] font-medium text-bad">
            {source.name} only has {formatMoney(source.available, currency)}.
          </p>
        )}
      </div>

      {amount > 0 && !tooMuch && (
        <div className="flex flex-col gap-1.5 rounded-xl bg-paper px-3.5 py-3 text-sm">
          <div className="flex justify-between">
            <span>{target.name}</span>
            <span className={cn("font-semibold", target.remaining + amount >= 0 ? "text-ok" : "text-bad")}>
              {formatAmount(target.remaining)} → {formatAmount(target.remaining + amount)}
            </span>
          </div>
          {source.kind === "category" ? (
            <div className="flex justify-between">
              <span>{source.name}</span>
              <span className="font-semibold">
                {formatAmount(source.available)} → {formatAmount(source.available - amount)}
              </span>
            </div>
          ) : (
            <div className="flex justify-between">
              <span>{target.name}&apos;s cap this month</span>
              <span className="font-semibold">
                {formatAmount(target.effectiveAllocation)} → {formatAmount(target.effectiveAllocation + amount)}
              </span>
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        disabled={pending || !amount || tooMuch}
        onClick={submit}
        className="mt-1 min-h-14 rounded-2xl bg-ink text-[17px] font-semibold text-white disabled:opacity-50"
      >
        {pending ? "Saving…" : source.kind === "raise" ? `Raise cap by ${formatMoney(amount, currency)}` : `Move ${formatMoney(amount, currency)}`}
      </button>
    </Sheet>
  );
}
