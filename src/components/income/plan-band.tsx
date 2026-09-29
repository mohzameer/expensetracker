"use client";

import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import { Check, Clock } from "lucide-react";
import { receiveIncomeAction, undoReceiveIncomeAction } from "@/server/actions";
import type { IncomeLine, MonthPlan } from "@/server/queries";
import { formatDay, formatMonth } from "@/lib/dates";
import { formatAmount, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Carried in + income − budgets = free after the month, with the income lines to mark received. */
export function PlanBand({
  ym,
  plan,
  income,
  currency,
  readOnly,
}: {
  ym: string;
  plan: MonthPlan;
  income: IncomeLine[];
  currency: string;
  readOnly: boolean;
}) {
  const [pending, start] = useTransition();
  const month = formatMonth(ym, { month: "long" });

  const receive = (line: IncomeLine) =>
    start(async () => {
      const res = await receiveIncomeAction(line.id);
      if (!res.ok) toast.error(res.error);
      else toast.success(`${line.source} received · ${formatMoney(line.amount, currency)} added to Savings`);
    });
  const undo = (line: IncomeLine) =>
    start(async () => {
      const res = await undoReceiveIncomeAction(line.id);
      if (!res.ok) toast.error(res.error);
      else toast(`${line.source} is expected again`);
    });

  return (
    <section aria-label="Money plan" className="card flex flex-col gap-4 px-5 py-4">
      {plan.kind === "plan" ? (
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <Figure label="Carried in" value={formatMoney(plan.carriedIn, currency)} />
          <Op>+</Op>
          <Figure
            label="Income"
            value={formatMoney(plan.received + plan.expected, currency)}
            sub={plan.expected > 0 ? `${formatAmount(plan.expected)} still expected` : undefined}
          />
          <Op>−</Op>
          <Figure label={`${month} budgets`} value={formatMoney(plan.budgets, currency)} />
          <Op>=</Op>
          <Figure
            label={`Free after ${month}`}
            value={formatMoney(plan.freeAfter, currency)}
            className={plan.freeAfter < 0 ? "text-bad" : "text-ok"}
            sub="if every budget is spent"
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <Figure label="Income received" value={formatMoney(plan.received, currency)} />
          <Figure label="Spent" value={formatMoney(plan.spent, currency)} />
          <Figure label="Returned to Savings" value={formatMoney(plan.returned, currency)} className="text-ok" />
        </div>
      )}

      {income.length > 0 ? (
        <ul className="flex flex-wrap gap-2 border-t border-line-soft pt-3">
          {income.map((i) => (
            <li
              key={i.id}
              className={cn(
                "flex min-h-10 items-center gap-2 rounded-full border px-3 text-sm",
                i.status === "received" ? "border-ok-bg bg-ok-bg/60" : "border-dashed border-line-strong",
              )}
            >
              {i.status === "received" ? (
                <Check aria-label="Received" className="size-4 text-ok" strokeWidth={2.5} />
              ) : (
                <Clock aria-label="Expected" className="size-4 text-muted-ink" />
              )}
              <span>{i.source}</span>
              <span className="font-semibold">{formatAmount(i.amount)}</span>
              {i.status === "received" ? (
                <>
                  <span className="text-xs text-muted-ink">{i.receivedOn ? formatDay(i.receivedOn, { day: "numeric", month: "short" }) : ""}</span>
                  {!readOnly && (
                    <button disabled={pending} onClick={() => undo(i)} className="text-xs font-medium text-muted-ink underline">
                      Undo
                    </button>
                  )}
                </>
              ) : (
                !readOnly && (
                  <button
                    disabled={pending}
                    onClick={() => receive(i)}
                    className="rounded-full bg-teal px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Mark received
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t border-line-soft pt-3 text-[13px] text-muted-ink">
          No income for {month}.{" "}
          <Link href={`/setup?month=${ym}`} className="font-semibold text-teal underline">
            Add it in Setup
          </Link>
        </p>
      )}
    </section>
  );
}

function Op({ children }: { children: React.ReactNode }) {
  return (
    <span aria-hidden className="pb-1 text-xl text-faint">
      {children}
    </span>
  );
}

function Figure({ label, value, sub, className }: { label: string; value: string; sub?: string; className?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[13px] text-muted-ink">{label}</span>
      <span className={cn("font-display text-xl font-semibold", className)}>{value}</span>
      {sub && <span className="text-xs text-muted-ink">{sub}</span>}
    </div>
  );
}
