import { AlertTriangle, CircleAlert, Check } from "lucide-react";
import type { BudgetState } from "@/lib/budget";
import { formatAmount, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const STYLES: Record<BudgetState, string> = {
  green: "bg-ok-bg text-ok",
  amber: "bg-warn-bg text-warn",
  red: "bg-bad-bg text-bad",
};

/** The live line under the category: green / amber / red. */
export function BudgetLine({
  state,
  remainingAfter,
  effectiveAllocation,
  pctLeft,
  alertPct,
  categoryName,
  currency,
  detailed = false,
}: {
  state: BudgetState;
  remainingAfter: number;
  effectiveAllocation: number;
  pctLeft: number;
  alertPct: number;
  categoryName: string;
  currency: string;
  detailed?: boolean;
}) {
  const Icon = state === "green" ? Check : state === "amber" ? AlertTriangle : CircleAlert;
  const title =
    state === "green"
      ? `${formatMoney(remainingAfter, currency)} left of ${formatAmount(effectiveAllocation)}`
      : state === "amber"
        ? `Only ${formatMoney(remainingAfter, currency)} left${detailed ? ` in ${categoryName}` : ` (${pctLeft.toFixed(1)}%)`}`
        : `Over by ${formatMoney(-remainingAfter, currency)}`;
  const detail =
    state === "amber"
      ? `After this, ${pctLeft.toFixed(1)}% of ${formatMoney(effectiveAllocation, currency)} remains — below your ${alertPct}% alert.`
      : state === "red"
        ? `${categoryName} will go negative. You can cover it from another category or Savings.`
        : null;

  return (
    <div role="status" aria-live="polite" className={cn("flex items-start gap-3 rounded-[14px] p-3.5", STYLES[state])}>
      <Icon aria-hidden className="mt-px size-5 shrink-0" strokeWidth={2.2} />
      <div className="flex flex-col gap-0.5">
        <span className="text-[15px] font-semibold">{title}</span>
        {detailed && detail && <span className="text-[13px]">{detail}</span>}
      </div>
    </div>
  );
}
