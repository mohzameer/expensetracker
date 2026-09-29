"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Sheet } from "./sheet";
import { moveToCategoryAction } from "@/server/actions";
import type { CategorySummary } from "@/server/queries";
import { formatAmount, formatMoney, parseMoney, toInputValue } from "@/lib/money";
import { cn } from "@/lib/utils";

type Source = { key: string; kind: "category" | "savings"; categoryId?: string; name: string; available: number };

/** Cover a negative category from another category's balance or from Savings. */
export function CoverSheet({
  open,
  onOpenChange,
  target,
  summaries,
  savings,
  currency,
  ym,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: CategorySummary;
  summaries: CategorySummary[];
  savings: number;
  currency: string;
  ym: string;
}) {
  const deficit = Math.max(-target.remaining, 0);
  const sources: Source[] = [
    ...summaries
      .filter((s) => s.categoryId !== target.categoryId && s.remaining > 0)
      .sort((a, b) => b.remaining - a.remaining)
      .map((s) => ({ key: s.categoryId, kind: "category" as const, categoryId: s.categoryId, name: s.name, available: s.remaining })),
    { key: "savings", kind: "savings", name: "Savings", available: savings },
  ];
  const firstFit = sources.find((s) => s.available >= deficit) ?? sources[0];
  const [sourceKey, setSourceKey] = useState(firstFit.key);
  const [amountStr, setAmountStr] = useState(toInputValue(deficit || null));
  const [pending, start] = useTransition();

  const source = sources.find((s) => s.key === sourceKey)!;
  const amount = parseMoney(amountStr) ?? 0;
  const tooMuch = amount > source.available;

  const submit = () =>
    start(async () => {
      const res = await moveToCategoryAction({
        ym,
        toCategoryId: target.categoryId,
        source: source.kind === "savings" ? { kind: "savings" } : { kind: "category", categoryId: source.categoryId! },
        amount,
        reason: "cover",
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Moved ${formatMoney(amount, currency)} from ${source.name} to ${target.name}`);
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
          <span className="text-muted-ink">Top up {target.name} from another category or Savings.</span>
        )
      }
    >
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="pb-2 text-[13px] font-semibold text-muted-ink">Take it from</legend>
        {sources.map((s) => {
          const checked = s.key === sourceKey;
          return (
            <label
              key={s.key}
              className={cn(
                "flex min-h-[52px] cursor-pointer items-center gap-3 rounded-xl border px-3.5",
                checked ? "border-[1.5px] border-teal bg-teal-wash" : "border-line",
                s.kind === "savings" && !checked && "bg-[#FAF9F5]",
              )}
            >
              <input
                type="radio"
                name="source"
                checked={checked}
                onChange={() => setSourceKey(s.key)}
                className="size-5 accent-teal"
              />
              <span className={cn("flex-1 text-[15px]", s.kind === "savings" ? "font-semibold" : "font-medium")}>{s.name}</span>
              <span className="text-sm text-muted-ink">
                {formatAmount(s.available)}
                {s.kind === "category" ? " left" : ""}
              </span>
            </label>
          );
        })}
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
        {tooMuch && (
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
          <div className="flex justify-between">
            <span>{source.name}</span>
            <span className="font-semibold">
              {formatAmount(source.available)} → {formatAmount(source.available - amount)}
            </span>
          </div>
        </div>
      )}

      <button
        type="button"
        disabled={pending || !amount || tooMuch}
        onClick={submit}
        className="mt-1 min-h-14 rounded-2xl bg-ink text-[17px] font-semibold text-white disabled:opacity-50"
      >
        {pending ? "Moving…" : `Move ${formatMoney(amount, currency)}`}
      </button>
    </Sheet>
  );
}
