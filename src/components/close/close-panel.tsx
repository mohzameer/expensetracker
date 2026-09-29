"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, Info, Lock } from "lucide-react";
import { MonthHeader } from "@/components/page-header";
import { assignCategoryAction, closeMonthAction, moveToCategoryAction } from "@/server/actions";
import type { getClosePage } from "@/server/queries";
import { addMonths, formatDay, formatMonth, lastDay } from "@/lib/dates";
import { formatAmount, formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

type Data = Awaited<ReturnType<typeof getClosePage>>;

const selectCls =
  "min-h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-[15px] outline-none focus:border-teal sm:w-56";

export function ClosePanel({ data }: { data: Data }) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const month = formatMonth(data.ym, { month: "long" });
  const closed = data.month?.status === "closed";
  const { blockers } = data;
  const negatives = data.summaries.filter((s) => s.remaining < 0);
  const blocking = data.uncategorized.length + negatives.length;
  const headsUp = (categoryId: string) =>
    data.monthly
      .filter((m) => m.categoryId === categoryId && m.status !== "paid")
      .map((m) => (m.status === "partial" ? `${m.name} still owes ${formatAmount(m.expected - m.paid)}` : `${m.name} unpaid (${formatAmount(m.expected)})`))
      .join(" · ");

  const run = <T,>(fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>, success: (d: T) => string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error);
      else toast.success(success(res.data));
    });

  const totals = data.summaries.reduce(
    (a, s) => ({
      allocated: a.allocated + s.effectiveAllocation,
      spent: a.spent + s.spent,
      toSavings: a.toSavings + (closed ? s.swept : Math.max(s.remaining, 0)),
    }),
    { allocated: 0, spent: 0, toSavings: 0 },
  );

  const reasons: string[] = [];
  if (!data.month) reasons.push(`Nothing has been recorded for ${month}.`);
  if (blockers.earlierOpen.length) reasons.push(`Close ${formatMonth(blockers.earlierOpen[0])} first.`);
  if (blockers.notEnded) reasons.push(`${month} can be closed from ${formatDay(lastDay(data.ym))}.`);
  if (blocking) reasons.push(`Resolve ${blocking} blocking item${blocking === 1 ? "" : "s"} to continue.`);
  const canClose = !closed && reasons.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-[22px] px-4 py-6 lg:px-9 lg:py-7">
      <MonthHeader ym={data.ym} href={(ym) => `/close/${ym}`} title={`Close ${formatMonth(data.ym)}`} />
      <p className="-mt-2 text-[15px] text-muted-ink">
        Everything on one page. Resolve the blocking items, check the sweep, then close. A closed month is read-only.
      </p>

      {closed && (
        <div className="flex items-center gap-3 rounded-2xl bg-lock-bg px-4 py-3.5 text-ink-soft">
          <Lock aria-hidden className="size-5 shrink-0" />
          <span className="text-[15px]">
            <b>{month} is closed.</b> {formatMoney(totals.toSavings, data.currency)} went to Savings
            {data.closedAt ? ` on ${formatDay(data.closedAt.slice(0, 10))}` : ""}.
          </span>
        </div>
      )}
      {!closed && blockers.earlierOpen.length > 0 && (
        <div className="flex items-center gap-3 rounded-2xl bg-warn-bg px-4 py-3.5 text-warn">
          <Info aria-hidden className="size-5 shrink-0" />
          <span className="text-[15px]">
            Months close in order.{" "}
            <Link href={`/close/${blockers.earlierOpen[0]}`} className="font-semibold underline">
              Close {formatMonth(blockers.earlierOpen[0])} first
            </Link>
            .
          </span>
        </div>
      )}

      {!closed && data.pendingIncome.length > 0 && (
        <div className="flex items-center gap-3 rounded-2xl bg-paper px-4 py-3.5 text-ink-soft ring-1 ring-line">
          <Info aria-hidden className="size-5 shrink-0" />
          <span className="text-[15px]">
            Still expected: {data.pendingIncome.map((i) => `${i.source} ${formatAmount(i.amount)}`).join(", ")}. Closing moves{" "}
            {data.pendingIncome.length === 1 ? "it" : "them"} to {formatMonth(addMonths(data.ym, 1), { month: "long" })}.
          </span>
        </div>
      )}

      {!closed && data.month && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[17px] font-semibold">Needs category</h2>
              <Badge n={data.uncategorized.length} />
            </div>
            {data.uncategorized.length === 0 ? (
              <Clear text="Every expense has a category." />
            ) : (
              data.uncategorized.map((e) => (
                <div key={e.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-paper px-3.5 py-2.5">
                  <span className="w-14 text-[13px] text-muted-ink">{formatDay(e.spentOn, { day: "numeric", month: "short" })}</span>
                  <span className="flex-1 text-[15px] font-medium">{e.note ?? "Unlabelled"}</span>
                  <span className="text-[15px] font-semibold">{formatAmount(e.amount)}</span>
                  <label htmlFor={`assign-${e.id}`} className="sr-only">
                    Category for {e.note ?? "expense"}
                  </label>
                  <select
                    id={`assign-${e.id}`}
                    disabled={pending}
                    defaultValue=""
                    className={selectCls}
                    onChange={(ev) => {
                      const c = data.categories.find((x) => x.id === ev.target.value);
                      if (c) run(() => assignCategoryAction({ id: e.id, categoryId: c.id }), () => `Assigned to ${c.name}`);
                    }}
                  >
                    <option value="" disabled>
                      Choose category…
                    </option>
                    {data.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              ))
            )}
          </section>

          <section className="card flex flex-col gap-3 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-[17px] font-semibold">Negative categories</h2>
              <Badge n={negatives.length} />
            </div>
            {negatives.length === 0 ? (
              <Clear text="No category is overspent." />
            ) : (
              negatives.map((n) => {
                const deficit = -n.remaining;
                const sources = [
                  ...data.summaries
                    .filter((s) => s.remaining > 0)
                    .map((s) => ({ key: s.categoryId, label: s.name, available: s.remaining })),
                  { key: "savings", label: "Savings", available: data.savings },
                ].filter((s) => s.available > 0);
                return (
                  <div key={n.categoryId} className="flex flex-wrap items-center gap-3 rounded-xl bg-paper px-3.5 py-2.5">
                    <span className="flex-1 text-[15px] font-medium">{n.name}</span>
                    <span className="text-[15px] font-semibold text-bad">{formatAmount(n.remaining)}</span>
                    <label htmlFor={`cover-${n.categoryId}`} className="sr-only">
                      Cover {n.name} from
                    </label>
                    <select
                      id={`cover-${n.categoryId}`}
                      disabled={pending}
                      defaultValue=""
                      className={selectCls}
                      onChange={(ev) => {
                        const src = sources.find((s) => s.key === ev.target.value);
                        if (!src) return;
                        const amount = Math.min(deficit, src.available);
                        run(
                          () =>
                            moveToCategoryAction({
                              ym: data.ym,
                              toCategoryId: n.categoryId,
                              source: src.key === "savings" ? { kind: "savings" } : { kind: "category", categoryId: src.key },
                              amount,
                              reason: "cover",
                            }),
                          () => `Moved ${formatMoney(amount, data.currency)} from ${src.label} to ${n.name}`,
                        );
                        ev.target.value = "";
                      }}
                    >
                      <option value="" disabled>
                        Cover from…
                      </option>
                      {sources.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label} ({formatAmount(s.available)})
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })
            )}
          </section>
        </div>
      )}

      <section className="card flex flex-col gap-2 overflow-x-auto p-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[17px] font-semibold">{closed ? "Swept to Savings" : "Sweep to Savings"}</h2>
          {!closed && <span className="text-[13px] text-muted-ink">Preview · updates as you cover</span>}
        </div>
        {data.summaries.length === 0 ? (
          <p className="py-4 text-[15px] text-muted-ink">No budgets for {month} yet.</p>
        ) : (
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-[13px] text-muted-ink">
                <th className="py-2 font-medium">Category</th>
                <th className="py-2 text-right font-medium">Allocated</th>
                <th className="py-2 text-right font-medium">Spent</th>
                <th className="py-2 text-right font-medium">To Savings</th>
                <th className="py-2 pl-6 font-medium">Heads-up</th>
              </tr>
            </thead>
            <tbody>
              {data.summaries.map((s) => {
                const toSavings = closed ? s.swept : s.remaining;
                const note = s.remaining < 0 && !closed ? "Cover before closing" : headsUp(s.categoryId);
                return (
                  <tr key={s.categoryId} className="border-b border-line-soft">
                    <td className="py-2.5 font-medium">
                      <span aria-hidden className="mr-2 inline-block size-2 rounded-full" style={{ background: s.color }} />
                      {s.name}
                    </td>
                    <td className="py-2.5 text-right">{formatAmount(s.effectiveAllocation)}</td>
                    <td className="py-2.5 text-right">{formatAmount(s.spent)}</td>
                    <td className={cn("py-2.5 text-right font-semibold", toSavings < 0 ? "text-bad" : "text-ok")}>{formatAmount(toSavings)}</td>
                    <td className={cn("py-2.5 pl-6 text-[13px]", s.remaining < 0 && !closed ? "font-semibold text-bad" : "text-warn")}>{note}</td>
                  </tr>
                );
              })}
              <tr className="font-semibold">
                <td className="pt-3">Total to Savings</td>
                <td className="pt-3 text-right">{formatAmount(totals.allocated)}</td>
                <td className="pt-3 text-right">{formatAmount(totals.spent)}</td>
                <td className="pt-3 text-right text-ok">{formatAmount(totals.toSavings)}</td>
                <td className="pt-3 pl-6 text-[13px] font-normal text-muted-ink">
                  {negatives.length > 0 && !closed ? `before ${negatives.map((n) => n.name).join(", ")} ${negatives.length === 1 ? "is" : "are"} covered` : ""}
                </td>
              </tr>
            </tbody>
          </table>
        )}
      </section>

      {!closed && (
        <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-paper px-4 py-4 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0">
          <div className="flex items-center gap-2.5 text-sm text-ink-soft">
            <Lock aria-hidden className="size-5 shrink-0" />
            <span>
              Once closed, {month} can&apos;t be edited. {reasons.join(" ")}
            </span>
          </div>
          <div className="flex gap-2">
            {confirming && (
              <button onClick={() => setConfirming(false)} className="min-h-12 rounded-xl border border-line-strong px-4 text-[15px] font-medium">
                Cancel
              </button>
            )}
            <button
              disabled={!canClose || pending}
              onClick={() => {
                if (!confirming) return setConfirming(true);
                run(() => closeMonthAction(data.ym), (d) => `${month} closed · ${formatMoney(d.swept, data.currency)} swept to Savings`);
                setConfirming(false);
              }}
              className="min-h-12 rounded-xl bg-ink px-6 text-[15px] font-semibold text-white disabled:opacity-40"
            >
              {pending ? "Working…" : confirming ? `Yes, close ${month}` : `Close ${month}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Badge({ n }: { n: number }) {
  return n > 0 ? (
    <span className="rounded-full bg-bad-bg px-2.5 py-1 text-xs font-semibold text-bad">Blocking · {n}</span>
  ) : (
    <span className="rounded-full bg-ok-bg px-2.5 py-1 text-xs font-semibold text-ok">Clear</span>
  );
}

function Clear({ text }: { text: string }) {
  return (
    <p className="flex items-center gap-2 text-[15px] text-muted-ink">
      <CheckCircle2 aria-hidden className="size-4 text-ok" /> {text}
    </p>
  );
}
