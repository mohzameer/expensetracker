"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Archive, Lock, Plus, Undo2, X } from "lucide-react";
import { MonthHeader } from "@/components/page-header";
import { saveSetupAction } from "@/server/actions";
import type { getSetupPage } from "@/server/queries";
import { formatMonth } from "@/lib/dates";
import { formatMoney, parseMoney, toInputValue } from "@/lib/money";
import { CATEGORY_COLORS } from "@/lib/palette";
import { cn } from "@/lib/utils";

type Data = Awaited<ReturnType<typeof getSetupPage>>;
type Kind = "monthly" | "one_off";
type ItemState = { key: string; id: string | null; name: string; kind: Kind; amount: string; removed: boolean };
type CatState = {
  key: string;
  id: string | null;
  name: string;
  color: string;
  allocation: string;
  alertPct: string;
  removed: boolean;
  items: ItemState[];
};

const CURRENCIES = [
  { symbol: "Rs", code: "LKR" },
  { symbol: "₹", code: "INR" },
  { symbol: "$", code: "USD" },
  { symbol: "€", code: "EUR" },
  { symbol: "£", code: "GBP" },
  { symbol: "A$", code: "AUD" },
  { symbol: "S$", code: "SGD" },
  { symbol: "AED", code: "AED" },
];

let seq = 0;
const newKey = () => `new-${++seq}`;

function initialState(data: Data): CatState[] {
  return data.categories.map((c) => ({
    key: c.id,
    id: c.id,
    name: c.name,
    color: c.color,
    allocation: toInputValue(c.allocation),
    alertPct: c.alertPct == null ? "" : String(c.alertPct),
    removed: false,
    items: c.items.map((i) => ({
      key: i.id,
      id: i.id,
      name: i.name,
      kind: i.kind,
      amount: toInputValue(i.kind === "monthly" ? i.expectedAmount : i.defaultAmount),
      removed: false,
    })),
  }));
}

const field = "min-h-10 w-full rounded-[10px] border border-line-strong bg-surface px-2.5 text-[15px] outline-none focus:border-teal disabled:bg-paper";
const label = "text-xs font-semibold text-muted-ink";

export function SetupForm({ data }: { data: Data }) {
  const initial = useMemo(() => initialState(data), [data]);
  const [cats, setCats] = useState<CatState[]>(initial);
  const [defaultAlert, setDefaultAlert] = useState(String(data.defaultAlertPct));
  const [currency, setCurrency] = useState(`${data.currencySymbol}|${data.currencyCode}`);
  const [defaultAccount, setDefaultAccount] = useState(data.defaultAccountId ?? "");
  const [startDay, setStartDay] = useState(String(data.periodStartDay));
  const [pending, start] = useTransition();

  const closed = data.month?.status === "closed";
  const missing = !data.month;
  const readOnly = closed || missing;
  const monthName = formatMonth(data.ym, { month: "long" });
  const [symbol, code] = currency.split("|");
  const currencyOptions = CURRENCIES.some((c) => c.code === data.currencyCode)
    ? CURRENCIES
    : [{ symbol: data.currencySymbol, code: data.currencyCode }, ...CURRENCIES];

  const dirty =
    JSON.stringify(cats) !== JSON.stringify(initial) ||
    defaultAlert !== String(data.defaultAlertPct) ||
    currency !== `${data.currencySymbol}|${data.currencyCode}` ||
    defaultAccount !== (data.defaultAccountId ?? "") ||
    startDay !== String(data.periodStartDay);

  const updateCat = (key: string, patch: Partial<CatState>) => setCats((cs) => cs.map((c) => (c.key === key ? { ...c, ...patch } : c)));
  const updateItem = (catKey: string, itemKey: string, patch: Partial<ItemState>) =>
    setCats((cs) =>
      cs.map((c) => (c.key === catKey ? { ...c, items: c.items.map((i) => (i.key === itemKey ? { ...i, ...patch } : i)) } : c)),
    );
  const removeItem = (catKey: string, item: ItemState) =>
    setCats((cs) =>
      cs.map((c) =>
        c.key === catKey
          ? { ...c, items: item.id ? c.items.map((i) => (i.key === item.key ? { ...i, removed: !i.removed } : i)) : c.items.filter((i) => i.key !== item.key) }
          : c,
      ),
    );

  const live = cats.filter((c) => !c.removed);
  const monthlyCommit = (c: CatState) =>
    c.items.filter((i) => !i.removed && i.kind === "monthly").reduce((a, i) => a + (parseMoney(i.amount) ?? 0), 0);
  const totals = {
    categories: live.length,
    items: live.reduce((a, c) => a + c.items.filter((i) => !i.removed).length, 0),
    monthly: live.reduce((a, c) => a + monthlyCommit(c), 0),
    allocated: live.reduce((a, c) => a + (parseMoney(c.allocation) ?? 0), 0),
  };
  // Live version of the dashboard's "free after the month" while you edit caps.
  const pb = data.planBase;
  const freeAfter = !pb
    ? null
    : pb.kind === "current"
      ? pb.base -
        live.reduce((a, c) => a + Math.max((parseMoney(c.allocation) ?? 0) + (c.id ? (pb.deltas[c.id] ?? 0) : 0), 0), 0)
      : pb.base - totals.allocated;

  const copyCaps = () => {
    const prev = data.prevAllocations;
    if (!Object.keys(prev).length) return void toast.error(`No caps set for ${formatMonth(data.prevYm, { month: "long" })}.`);
    setCats((cs) => cs.map((c) => (c.id && prev[c.id] !== undefined ? { ...c, allocation: toInputValue(prev[c.id]) } : c)));
    toast(`Copied caps from ${formatMonth(data.prevYm, { month: "long" })}`);
  };

  const save = () => {
    // Validate here for friendly messages; the server validates again.
    for (const c of live) {
      if (!c.name.trim()) return void toast.error("Every category needs a name.");
      if (c.allocation && parseMoney(c.allocation) == null) return void toast.error(`${c.name}: the cap isn't a valid amount.`);
      for (const i of c.items.filter((x) => !x.removed)) {
        if (!i.name.trim()) return void toast.error(`${c.name}: every item needs a name.`);
        if (i.kind === "monthly" && !parseMoney(i.amount)) return void toast.error(`${i.name}: monthly items need an expected amount.`);
      }
    }
    const names = live.map((c) => c.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) return void toast.error("Two categories have the same name.");

    start(async () => {
      const res = await saveSetupAction({
        ym: data.ym,
        defaultAlertPct: Number(defaultAlert) || 0,
        currencySymbol: symbol,
        currencyCode: code,
        defaultAccountId: defaultAccount || null,
        periodStartDay: Math.min(Math.max(Number(startDay) || 1, 1), 28),
        categories: cats
          .filter((c) => c.id || !c.removed)
          .map((c) => ({
            id: c.id,
            name: c.name,
            color: c.color,
            allocation: parseMoney(c.allocation) ?? 0,
            alertPct: c.alertPct === "" ? null : Number(c.alertPct),
            removed: c.removed,
            items: c.items.map((i) => {
              const amt = parseMoney(i.amount);
              return {
                id: i.id,
                name: i.name,
                kind: i.kind,
                expectedAmount: i.kind === "monthly" ? amt : null,
                defaultAmount: i.kind === "one_off" ? amt : null,
                removed: i.removed,
              };
            }),
          })),
      });
      if (!res.ok) toast.error(res.error);
      else toast.success(`Saved ${monthName} setup`);
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 pt-6 lg:px-9 lg:pt-7">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex flex-col gap-1.5">
          <MonthHeader ym={data.ym} range={data.range} href={(ym) => `/setup?month=${ym}`} title={`Setup · ${formatMonth(data.ym)}`} />
          <span className="text-sm text-muted-ink">
            Everything on one page. Categories and monthly items carry into every month; one-off items are for {monthName} only.
            Caps and alert % apply to {monthName}.
          </span>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="defalert" className={label}>Default alert %</label>
            <input
              id="defalert"
              inputMode="numeric"
              disabled={readOnly}
              value={defaultAlert}
              onChange={(e) => setDefaultAlert(e.target.value.replace(/\D/g, "").slice(0, 3))}
              className={cn(field, "w-[100px]")}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="cur" className={label}>Currency</label>
            <select id="cur" disabled={readOnly} value={currency} onChange={(e) => setCurrency(e.target.value)} className={cn(field, "w-auto")}>
              {currencyOptions.map((c) => (
                <option key={c.code} value={`${c.symbol}|${c.code}`}>
                  {c.symbol} ({c.code})
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="startday" className={label} title="Applies to months not created yet">
              Month starts on day
            </label>
            <input
              id="startday"
              inputMode="numeric"
              disabled={readOnly}
              value={startDay}
              onChange={(e) => setStartDay(e.target.value.replace(/\D/g, "").slice(0, 2))}
              aria-describedby="startday-hint"
              className={cn(field, "w-[100px]")}
            />
            <span id="startday-hint" className="sr-only">Applies to months not created yet</span>
          </div>
          {data.accounts.length > 0 && (
            <div className="flex flex-col gap-1">
              <label htmlFor="defacct" className={label}>Default account</label>
              <select id="defacct" disabled={readOnly} value={defaultAccount} onChange={(e) => setDefaultAccount(e.target.value)} className={cn(field, "w-auto")}>
                {data.accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          )}
          <button
            type="button"
            disabled={readOnly}
            onClick={copyCaps}
            className="min-h-10 rounded-[10px] border border-teal bg-surface px-3.5 text-sm font-semibold text-teal disabled:opacity-50"
          >
            Copy caps from {formatMonth(data.prevYm, { month: "long" })}
          </button>
        </div>
      </div>

      {closed && (
        <div className="flex items-center gap-3 rounded-2xl bg-lock-bg px-4 py-3.5 text-ink-soft">
          <Lock aria-hidden className="size-5" /> {monthName} is closed. Its caps are read-only.
        </div>
      )}
      {missing && (
        <div className="card px-6 py-10 text-center text-[15px] text-muted-ink">No budget was set for {formatMonth(data.ym)}.</div>
      )}

      {!missing && (
        <fieldset disabled={readOnly || pending} className="m-0 grid min-w-0 items-start gap-4 border-0 p-0 xl:grid-cols-2">
          <legend className="sr-only">Categories</legend>
          {cats.map((c) => {
            const commit = monthlyCommit(c);
            const cap = parseMoney(c.allocation) ?? 0;
            if (c.removed) {
              return (
                <section key={c.key} className="flex items-center gap-3 rounded-2xl border border-dashed border-line-strong px-5 py-4 text-sm text-muted-ink">
                  <span className="size-3 rounded" style={{ background: c.color }} />
                  <span className="flex-1">
                    <b className="text-ink">{c.name}</b> will be {c.id ? "archived (or deleted if it has no history)" : "discarded"} on save.
                  </span>
                  <button type="button" onClick={() => updateCat(c.key, { removed: false })} className="flex min-h-10 items-center gap-1.5 rounded-[10px] px-3 font-semibold text-teal">
                    <Undo2 aria-hidden className="size-4" /> Undo
                  </button>
                </section>
              );
            }
            return (
              <section key={c.key} className="card flex min-w-0 flex-col gap-3 rounded-2xl px-5 py-[18px]">
                <div className="grid grid-cols-[28px_minmax(0,1fr)_minmax(0,130px)_72px_40px] items-end gap-2.5">
                  <label className="relative mb-1.5 size-7 cursor-pointer rounded-lg" style={{ background: c.color }}>
                    <span className="sr-only">Colour for {c.name}</span>
                    <input
                      type="color"
                      value={c.color}
                      onChange={(e) => updateCat(c.key, { color: e.target.value.toUpperCase() })}
                      className="absolute inset-0 cursor-pointer opacity-0"
                    />
                  </label>
                  <div className="flex min-w-0 flex-col gap-1">
                    <label htmlFor={`${c.key}-n`} className={label}>Category</label>
                    <input id={`${c.key}-n`} autoFocus={!c.id && !c.name} value={c.name} onChange={(e) => updateCat(c.key, { name: e.target.value })} className={field} />
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <label htmlFor={`${c.key}-a`} className={cn(label, "truncate")}>{formatMonth(data.ym, { month: "short" })} cap ({symbol})</label>
                    <input id={`${c.key}-a`} inputMode="decimal" placeholder="0" value={c.allocation} onChange={(e) => updateCat(c.key, { allocation: e.target.value })} className={cn(field, "text-right")} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label htmlFor={`${c.key}-p`} className={label}>Alert %</label>
                    <input
                      id={`${c.key}-p`}
                      inputMode="numeric"
                      placeholder={defaultAlert}
                      value={c.alertPct}
                      onChange={(e) => updateCat(c.key, { alertPct: e.target.value.replace(/\D/g, "").slice(0, 3) })}
                      className={field}
                    />
                  </div>
                  <button
                    type="button"
                    aria-label={`Archive ${c.name}`}
                    title="Archive"
                    onClick={() => (c.id ? updateCat(c.key, { removed: true }) : setCats((cs) => cs.filter((x) => x.key !== c.key)))}
                    className="flex size-10 items-center justify-center rounded-[10px] border border-line text-muted-ink hover:text-bad"
                  >
                    <Archive aria-hidden className="size-4" />
                  </button>
                </div>
                {commit > 0 && (
                  <div className={cn("text-[13px]", commit > cap ? "font-semibold text-warn" : "text-muted-ink")}>
                    Monthly items commit {formatMoney(commit, symbol)} of this cap
                    {commit > cap ? ` — ${formatMoney(commit - cap, symbol)} more than the cap` : ""}
                  </div>
                )}
                <div className="flex flex-col gap-1.5 border-t border-line-soft pt-2.5">
                  {c.items.length > 0 && (
                    <div className="grid grid-cols-[minmax(0,1fr)_110px_110px_40px] gap-2.5 text-[11px] font-semibold tracking-wider text-muted-ink uppercase">
                      <span>Item</span>
                      <span>Kind</span>
                      <span className="text-right">Amount</span>
                      <span />
                    </div>
                  )}
                  {c.items.map((i) => (
                    <div key={i.key} className={cn("grid grid-cols-[minmax(0,1fr)_110px_110px_40px] items-center gap-2.5", i.removed && "opacity-50")}>
                      <input
                        aria-label="Item name"
                        autoFocus={!i.id && !i.name}
                        value={i.name}
                        disabled={i.removed}
                        onChange={(e) => updateItem(c.key, i.key, { name: e.target.value })}
                        className={cn(field, i.removed && "line-through")}
                      />
                      <select
                        aria-label={`Kind of ${i.name || "item"}`}
                        value={i.kind}
                        disabled={i.removed}
                        onChange={(e) => updateItem(c.key, i.key, { kind: e.target.value as Kind })}
                        className={field}
                      >
                        <option value="one_off">One-off</option>
                        <option value="monthly">Monthly</option>
                      </select>
                      <input
                        aria-label={`Amount for ${i.name || "item"}`}
                        inputMode="decimal"
                        placeholder={i.kind === "monthly" ? "Required" : "—"}
                        value={i.amount}
                        disabled={i.removed}
                        onChange={(e) => updateItem(c.key, i.key, { amount: e.target.value })}
                        className={cn(field, "text-right", i.kind === "monthly" && !parseMoney(i.amount) && !i.removed && "border-warn-bar")}
                      />
                      <button
                        type="button"
                        aria-label={i.removed ? `Restore ${i.name}` : `Remove ${i.name}`}
                        onClick={() => removeItem(c.key, i)}
                        className="flex size-10 items-center justify-center rounded-[10px] text-muted-ink hover:bg-paper"
                      >
                        {i.removed ? <Undo2 className="size-4" /> : <X className="size-4" />}
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      updateCat(c.key, { items: [...c.items, { key: newKey(), id: null, name: "", kind: "one_off", amount: "", removed: false }] })
                    }
                    className="flex min-h-10 items-center gap-1.5 self-start rounded-[10px] px-2.5 text-sm font-semibold text-teal hover:bg-teal-wash"
                  >
                    <Plus aria-hidden className="size-4" /> Add item
                  </button>
                </div>
              </section>
            );
          })}
          <button
            type="button"
            onClick={() =>
              setCats((cs) => [
                ...cs,
                {
                  key: newKey(),
                  id: null,
                  name: "",
                  color: CATEGORY_COLORS[cs.length % CATEGORY_COLORS.length],
                  allocation: "",
                  alertPct: "",
                  removed: false,
                  items: [],
                },
              ])
            }
            className="flex min-h-[72px] items-center justify-center gap-2 rounded-2xl border border-dashed border-faint text-[15px] font-semibold text-teal hover:bg-surface"
          >
            <Plus aria-hidden className="size-5" /> Add category
          </button>
        </fieldset>
      )}

      <div className="sticky bottom-0 z-10 -mx-4 mt-2 flex flex-wrap items-center justify-between gap-4 border-t border-line bg-paper/95 px-4 py-4 backdrop-blur lg:-mx-9 lg:px-9">
        <dl className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
          <Stat label="Categories" value={String(totals.categories)} />
          <Stat label="Items" value={String(totals.items)} />
          <Stat label="Monthly commitments" value={formatMoney(totals.monthly, symbol)} />
          <Stat label="Total allocated" value={formatMoney(totals.allocated, symbol)} strong />
          {freeAfter !== null && (
            <Stat label={`Savings after ${monthName}`} value={formatMoney(freeAfter, symbol)} tone={freeAfter < 0 ? "bad" : "ok"} />
          )}
        </dl>
        {!readOnly && (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!dirty || pending}
              onClick={() => {
                setCats(initial);
                setDefaultAccount(data.defaultAccountId ?? "");
                setStartDay(String(data.periodStartDay));
                setDefaultAlert(String(data.defaultAlertPct));
                setCurrency(`${data.currencySymbol}|${data.currencyCode}`);
              }}
              className="min-h-12 rounded-xl border border-line-strong bg-surface px-4 text-[15px] font-medium disabled:opacity-40"
            >
              Discard changes
            </button>
            <button
              type="button"
              disabled={!dirty || pending}
              onClick={save}
              className="min-h-12 rounded-xl bg-ink px-6 text-[15px] font-semibold text-white disabled:opacity-40"
            >
              {pending ? "Saving…" : "Save all"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "ok" | "bad" }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-ink">{label}</dt>
      <dd className={cn("m-0 font-semibold", strong && "text-teal", tone === "ok" && "text-ok", tone === "bad" && "text-bad")}>{value}</dd>
    </div>
  );
}

