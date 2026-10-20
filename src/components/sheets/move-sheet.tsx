"use client";

import Link from "next/link";
import { useState } from "react";
import { Sheet } from "./sheet";
import type { PendingMessage } from "@/server/domain/messages";
import { formatDay } from "@/lib/dates";
import { formatAmount, formatMoney, parseMoney, toInputValue } from "@/lib/money";

export type MovePayload = { messageId: string; fromId: string; toId: string; amount: number; fee: number | null };

type Account = { id: string; name: string; balance: number };

const inputCls = "min-h-[52px] w-full rounded-xl border border-line-strong bg-surface px-3.5 text-base outline-none focus:border-teal";
const labelCls = "text-[13px] font-semibold text-muted-ink";

// The accounts last used for a bank account's transfers ("2001" → Amana to ComBank), per device.
const pairKey = (ref: string) => `ledger.move-pair.${ref}`;
function rememberedPair(ref: string | null): { fromId: string; toId: string } | null {
  if (!ref) return null;
  try {
    const raw = localStorage.getItem(pairKey(ref));
    return raw ? (JSON.parse(raw) as { fromId: string; toId: string }) : null;
  } catch {
    return null;
  }
}
function rememberPair(ref: string | null, pair: { fromId: string; toId: string }) {
  if (!ref) return;
  try {
    localStorage.setItem(pairKey(ref), JSON.stringify(pair));
  } catch {
    // Storage blocked: next time just starts from the defaults.
  }
}

/** Where a text's money most likely went: withdrawals into cash, transfers into the account last used. */
function initialPair(message: PendingMessage, accounts: Account[], defaultAccountId: string | null) {
  const has = (id: string | null | undefined): id is string => !!id && accounts.some((a) => a.id === id);
  const main = has(defaultAccountId) ? defaultAccountId : (accounts[0]?.id ?? "");
  if (message.kind === "withdrawal") {
    const cash = accounts.find((a) => /cash/i.test(a.name) && a.id !== main);
    return { fromId: main, toId: cash?.id ?? "" };
  }
  const saved = rememberedPair(message.accountRef);
  if (saved && has(saved.fromId) && has(saved.toId)) return saved;
  return { fromId: accounts.find((a) => a.id !== main)?.id ?? "", toId: main };
}

export function MoveSheet({
  open,
  onOpenChange,
  message,
  accounts,
  defaultAccountId,
  currency,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  message: PendingMessage;
  accounts: Account[];
  defaultAccountId: string | null;
  currency: string;
  onSubmit: (payload: MovePayload) => void;
}) {
  const [pair, setPair] = useState(() => initialPair(message, accounts, defaultAccountId));
  const [amountStr, setAmountStr] = useState(toInputValue(message.amount));
  const [withFee, setWithFee] = useState(!!message.fee);
  const amount = parseMoney(amountStr);
  const from = accounts.find((a) => a.id === pair.fromId);
  const withdrawal = message.kind === "withdrawal";
  const noCash = withdrawal && !pair.toId;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !pair.fromId || !pair.toId || pair.fromId === pair.toId) return;
    if (!withdrawal) rememberPair(message.accountRef, pair);
    onSubmit({ messageId: message.id, ...pair, amount, fee: withFee ? message.fee : null });
  };

  const select = (id: string, which: "fromId" | "toId") => (
    <select id={id} className={inputCls} value={pair[which]} onChange={(e) => setPair((p) => ({ ...p, [which]: e.target.value }))}>
      <option value="" disabled>
        Choose…
      </option>
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={withdrawal ? "Cash withdrawal" : "Bank transfer"}
      headerRight={<span className="rounded-full border border-line bg-paper px-3 py-1.5 text-sm font-medium">{formatDay(message.occurredOn)}</span>}
      description={<p className="m-0 line-clamp-3 text-[13px] text-muted-ink">“{message.body}”</p>}
    >
      <form onSubmit={submit} className="flex flex-col gap-[18px]">
        <div className="grid grid-cols-2 gap-2.5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mv-from" className={labelCls}>From</label>
            {select("mv-from", "fromId")}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="mv-to" className={labelCls}>To</label>
            {select("mv-to", "toId")}
          </div>
        </div>
        {noCash && (
          <p className="m-0 text-[13px] text-muted-ink">
            No cash account yet.{" "}
            <Link href="/savings" className="font-semibold text-teal">
              Add “Cash in hand” in Accounts
            </Link>
            , then come back.
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <label htmlFor="mv-amt" className={labelCls}>
            Amount{from ? ` · ${formatAmount(from.balance)} in ${from.name}` : ""}
          </label>
          <input id="mv-amt" inputMode="decimal" className={inputCls} value={amountStr} onChange={(e) => setAmountStr(e.target.value)} />
        </div>
        {!!message.fee && (
          <label className="flex min-h-11 items-center gap-3 text-[15px]">
            <input type="checkbox" checked={withFee} onChange={(e) => setWithFee(e.target.checked)} className="size-5 accent-[var(--teal)]" />
            Also take the {formatMoney(message.fee, currency)} bank charge from {from?.name ?? "the From account"}
          </label>
        )}
        <button
          type="submit"
          disabled={!amount || !pair.fromId || !pair.toId || pair.fromId === pair.toId}
          className="min-h-14 rounded-2xl bg-ink text-[17px] font-semibold text-white disabled:opacity-50"
        >
          Move {formatMoney(amount ?? 0, currency)}
        </button>
      </form>
    </Sheet>
  );
}
