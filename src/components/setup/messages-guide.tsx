"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, Check, Copy, Eye, EyeOff, Plus, X } from "lucide-react";
import { setMessageSendersAction, testMessageAction } from "@/server/actions";
import type { ParsedSms } from "@/lib/sms";
import { formatDay } from "@/lib/dates";
import { formatAmount } from "@/lib/money";
import { cn } from "@/lib/utils";

const KIND: Record<ParsedSms["kind"], string> = {
  purchase: "Purchase → From messages",
  withdrawal: "Cash withdrawal → Transfers",
  bank_transfer: "Bank transfer → Transfers",
  other: "Other bank text → From messages",
};

/** `lastReceivedAt` comes formatted from the server, in the app's timezone. */
export function MessagesGuide({
  endpoint,
  token,
  senders,
  lastReceivedAt,
}: {
  endpoint: string;
  token: string | null;
  senders: string[];
  lastReceivedAt: string | null;
}) {
  return (
    <div className="flex flex-col gap-5">
      <section className="card flex flex-col gap-3 p-4">
        <h2 className="eyebrow m-0">Your details</h2>
        <CopyField label="URL" value={endpoint} />
        {token ? (
          <CopyField label="Token" value={token} secret />
        ) : (
          <div className="flex gap-2.5 rounded-xl bg-warn-bg p-3 text-[13px] text-warn">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span>
              No token is set yet. Add an <code>INGEST_TOKEN</code> environment variable (32+ random characters, e.g. from{" "}
              <code>openssl rand -base64 32</code>) in Vercel → Project → Settings → Environment Variables, then redeploy.
            </span>
          </div>
        )}
        <span className="text-[13px] text-muted-ink">
          {lastReceivedAt ? `Last text received ${lastReceivedAt}.` : "No texts received yet."}
        </span>
      </section>

      <SendersCard initial={senders} />

      <section className="card flex flex-col gap-3 p-4">
        <h2 className="eyebrow m-0">Set up the automation on your iPhone</h2>
        <ol className="m-0 flex list-decimal flex-col gap-3 pl-5 text-[15px] leading-relaxed marker:font-semibold marker:text-muted-ink">
          <li>
            Open <b>Shortcuts</b> → <b>Automation</b> → <b>+</b> → <b>Message</b>.
          </li>
          <li>
            Set <b>Message Contains</b> to <Code>card ending</Code> (card purchases and ATM withdrawals). Choose <b>Run Immediately</b> and
            turn off <b>Notify When Run</b>. Tap <b>Next</b> → <b>New Blank Automation</b>.
          </li>
          <li>
            Add the action <b>Get Contents of URL</b> and tap <b>Show More</b>:
            <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5">
              <li>
                URL: paste the <b>URL</b> above.
              </li>
              <li>
                Method: <b>POST</b>.
              </li>
              <li>
                Headers: add <Code>Authorization</Code> with the value <Code>Bearer</Code>, a space, then the <b>Token</b> above.
              </li>
              <li>
                Request Body: <b>JSON</b>. Add a Text field <Code>text</Code> and pick <b>Shortcut Input</b> → <b>Content</b>. Add a second Text
                field <Code>sender</Code> with <b>Shortcut Input</b> → <b>Sender</b>.
              </li>
            </ul>
          </li>
          <li>
            Make a second automation the same way with <b>Message Contains</b> <Code>trf of</Code> for bank transfers (e.g. Amana → ComBank).
            In Shortcuts you can duplicate the first one and just change the word.
          </li>
          <li>
            That&apos;s it. Texts from senders that aren&apos;t on the allowed list, one-time passwords, declined cards and account POS texts
            are ignored here, so a broad filter is safe, and the same text arriving twice is only kept once.
          </li>
        </ol>
      </section>

      <TestBox />
    </div>
  );
}

/** Texts from anyone else are dropped on arrival. Saved on every change. */
function SendersCard({ initial }: { initial: string[] }) {
  const [list, setList] = useState(initial);
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();

  const save = (next: string[], done: string) =>
    start(async () => {
      const before = list;
      setList(next);
      const res = await setMessageSendersAction(next);
      if (!res.ok) {
        setList(before);
        return void toast.error(res.error);
      }
      setList(res.data);
      toast.success(done);
    });

  const add = () => {
    const name = draft.trim();
    if (!name) return;
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (list.some((s) => s.toLowerCase().replace(/[^a-z0-9]/g, "") === key)) return void toast(`${name} is already on the list`);
    setDraft("");
    save([...list, name], `Texts from ${name} will be kept`);
  };

  return (
    <section className="card flex flex-col gap-3 p-4">
      <h2 className="eyebrow m-0">Allowed senders</h2>
      <p className="m-0 text-[13px] text-muted-ink">
        Only texts from these senders are kept; anything else your automation forwards is dropped. Use the name shown at the top of the
        conversation in Messages. {list.length === 0 && <b className="text-warn">The list is empty, so texts from anyone are kept.</b>}
      </p>
      {list.length > 0 && (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {list.map((s) => (
            <li key={s} className="flex min-h-9 items-center gap-1 rounded-full border border-line bg-paper pr-1 pl-3 text-[14px] font-medium">
              {s}
              <button
                type="button"
                disabled={pending}
                onClick={() => save(list.filter((x) => x !== s), `Texts from ${s} will be dropped`)}
                aria-label={`Remove ${s}`}
                className="flex size-7 items-center justify-center rounded-full text-muted-ink hover:bg-line-soft hover:text-ink"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        className="flex gap-2"
      >
        <input
          aria-label="Sender name"
          value={draft}
          maxLength={60}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. HNB"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-line-strong bg-surface px-3 text-[15px] outline-none focus:border-teal"
        />
        <button
          type="submit"
          disabled={pending || !draft.trim()}
          className="flex min-h-11 items-center gap-1 rounded-xl border border-line-strong bg-surface px-4 text-[15px] font-semibold disabled:opacity-40"
        >
          <Plus aria-hidden className="size-4" /> Add
        </button>
      </form>
    </section>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded-md bg-paper px-1.5 py-0.5 text-[13px]">{children}</code>;
}

function CopyField({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const [shown, setShown] = useState(!secret);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy. Select it and copy by hand.");
      setShown(true);
    }
  };
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[13px] font-semibold text-muted-ink">{label}</span>
      <div className="flex items-center gap-1.5">
        <code className="min-h-11 flex-1 truncate rounded-xl border border-line bg-paper px-3 py-2.5 text-[14px] select-all">
          {shown ? value : `••••••••${value.slice(-4)}`}
        </code>
        {secret && (
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            aria-label={shown ? `Hide ${label}` : `Show ${label}`}
            className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface"
          >
            {shown ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
          </button>
        )}
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy ${label}`}
          className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface"
        >
          {copied ? <Check aria-hidden className="size-4 text-ok" /> : <Copy aria-hidden className="size-4" />}
        </button>
      </div>
    </div>
  );
}

type TestResult = Awaited<ReturnType<typeof testMessageAction>>;

function TestBox() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<TestResult | null>(null);
  const [pending, start] = useTransition();
  const ok = result?.ok ? result.data : null;
  const p = ok?.parsed;

  return (
    <section className="card flex flex-col gap-3 p-4">
      <h2 className="eyebrow m-0">Try a text</h2>
      <p className="m-0 text-[13px] text-muted-ink">
        Paste a bank text to see how it&apos;s read. It goes through the same path as the iPhone, so a real transaction will show up on Daily entry.
      </p>
      <textarea
        aria-label="Bank text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="Dear Cardholder, Purchase at … for LKR 570.00 on 20/10/26 07:47 AM has been authorised…"
        className="w-full rounded-xl border border-line-strong bg-surface p-3 text-[15px] outline-none focus:border-teal"
      />
      <button
        type="button"
        disabled={pending || !text.trim()}
        onClick={() =>
          start(async () => {
            const res = await testMessageAction({ text });
            setResult(res);
            if (!res.ok) toast.error(res.error);
          })
        }
        className="min-h-12 rounded-xl bg-ink px-5 text-[15px] font-semibold text-white disabled:opacity-40"
      >
        {pending ? "Sending…" : "Send test text"}
      </button>
      {ok && (
        <div className={cn("rounded-xl p-3 text-[14px]", ok.ignored ? "bg-paper text-muted-ink" : "bg-teal-wash")}>
          {ok.ignored || !p ? (
            "Ignored: not a transaction (OTP, declined card or account POS text)."
          ) : (
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-ink">Read as</dt>
              <dd className="m-0 font-semibold">{KIND[p.kind]}</dd>
              {p.merchant && (
                <>
                  <dt className="text-muted-ink">Where</dt>
                  <dd className="m-0">{p.merchant}</dd>
                </>
              )}
              <dt className="text-muted-ink">Amount</dt>
              <dd className="m-0">
                {p.amount != null
                  ? formatAmount(p.amount)
                  : p.foreignCurrency && p.foreignAmount != null
                    ? `${p.foreignCurrency} ${formatAmount(p.foreignAmount)}${p.foreignCurrency === "USD" ? " (converted at the month's USD rate)" : ""}`
                    : "Not found: you'll type it in"}
                {p.fee ? ` + ${formatAmount(p.fee)} charge` : ""}
              </dd>
              <dt className="text-muted-ink">Date</dt>
              <dd className="m-0">{formatDay(p.occurredOn)}</dd>
              {ok.duplicate && (
                <>
                  <dt className="text-muted-ink">Note</dt>
                  <dd className="m-0">Already received; not added again.</dd>
                </>
              )}
            </dl>
          )}
        </div>
      )}
    </section>
  );
}
