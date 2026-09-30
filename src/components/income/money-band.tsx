import Link from "next/link";
import type { MonthPlan } from "@/server/queries";
import type { AccountBalance } from "@/server/domain/accounts";
import { formatMonth } from "@/lib/dates";
import { formatAmount, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

/** The month in cash terms, with your account balances underneath. */
export function MoneyBand({
  ym,
  plan,
  accounts,
  currency,
}: {
  ym: string;
  plan: MonthPlan;
  accounts: AccountBalance[];
  currency: string;
}) {
  const month = formatMonth(ym, { month: "long" });

  return (
    <section aria-label="Money" className="card flex flex-col gap-4 px-5 py-4">
      {plan.kind === "current" ? (
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <Figure label="In your accounts" value={formatMoney(plan.inAccounts, currency)} />
          <Op>−</Op>
          <Figure label={`Left to spend in ${month}`} value={formatMoney(plan.leftToSpend, currency)} sub="unspent budgets" />
          <Op>=</Op>
          <Figure
            label={`Free after ${month}`}
            value={formatMoney(plan.freeAfter, currency)}
            className={plan.freeAfter < 0 ? "text-bad" : "text-ok"}
            sub="if every budget is spent"
          />
        </div>
      ) : plan.kind === "future" ? (
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <Figure label="Carried in" value={formatMoney(plan.carriedIn, currency)} />
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
          <Figure label="Spent" value={formatMoney(plan.spent, currency)} />
          <Figure label="Left unspent" value={formatMoney(plan.returned, currency)} className="text-ok" />
        </div>
      )}

      {accounts.length > 0 && (
        <ul aria-label="Account balances" className="flex flex-wrap gap-2 border-t border-line-soft pt-3">
          {accounts.map((a) => (
            <li key={a.id}>
              <Link
                href="/savings"
                className="flex min-h-10 items-center gap-2 rounded-full border border-line px-3.5 text-sm hover:border-teal"
              >
                <span>{a.name}</span>
                <span className={cn("font-semibold", a.balance < 0 && "text-bad")}>{formatAmount(a.balance)}</span>
              </Link>
            </li>
          ))}
        </ul>
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
