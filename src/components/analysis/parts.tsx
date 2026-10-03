import type { getAnalysis } from "@/server/queries";
import { addDays, formatDay, formatRange, type Range } from "@/lib/dates";
import { presetRange, type Preset } from "@/lib/analysis";
import { cn } from "@/lib/utils";

export type Data = Awaited<ReturnType<typeof getAnalysis>>;
/** What is being analysed: one item (by category + name), a whole category, or everything. */
export type Target = { kind: "item"; key: string } | { kind: "category"; id: string } | null;
/** Custom dates are inclusive, as typed. */
export type RangeState = { preset: Preset; from: string; to: string };

export const field = "min-h-11 rounded-xl border border-line-strong bg-surface px-3 text-[15px] outline-none focus:border-teal";

export function resolveRange(s: RangeState, today: string, startDay: number): Range {
  if (s.preset !== "custom") return presetRange(s.preset, today, startDay);
  const [from, to] = s.from <= s.to ? [s.from, s.to] : [s.to, s.from];
  return { from, to: addDays(to, 1) };
}

const PRESETS: { id: Preset; label: string }[] = [
  { id: "month", label: "This month" },
  { id: "week", label: "This week" },
  { id: "last_month", label: "Last month" },
  { id: "last_3", label: "3 months" },
  { id: "year", label: "12 months" },
  { id: "custom", label: "Custom" },
];

export function RangeControl({ value, onChange, data }: { value: RangeState; onChange: (v: RangeState) => void; data: Data }) {
  const range = resolveRange(value, data.today, data.startDay);
  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label="Date range" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:px-0 [&::-webkit-scrollbar]:hidden">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={value.preset === p.id}
            onClick={() =>
              // Custom starts from the dates currently shown, so it can be nudged rather than retyped.
              onChange(p.id === "custom" ? { preset: "custom", from: range.from, to: addDays(range.to, -1) > data.today ? data.today : addDays(range.to, -1) } : { ...value, preset: p.id })
            }
            className={cn(
              "min-h-10 shrink-0 rounded-full border px-3.5 text-sm font-semibold whitespace-nowrap",
              value.preset === p.id ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-soft",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      {value.preset === "custom" ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-ink">
          <label className="flex items-center gap-2">
            From
            <input type="date" className={field} min={data.from} max={data.today} value={value.from} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} />
          </label>
          <label className="flex items-center gap-2">
            to
            <input type="date" className={field} min={data.from} max={data.today} value={value.to} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} />
          </label>
          <span className="text-xs">Goes back to {formatDay(data.from, { day: "numeric", month: "short", year: "numeric" })}.</span>
        </div>
      ) : (
        <span className="text-[13px] text-muted-ink">{formatRange(range.from, range.to)}</span>
      )}
    </div>
  );
}

/** `wide` takes the full row on a phone, so a long total is never cut off. */
export function Stat({ label, value, sub, wide }: { label: string; value: string; sub?: string; wide?: boolean }) {
  return (
    <div className={cn("card flex min-w-0 flex-col gap-0.5 px-3.5 py-3", wide && "col-span-2 lg:col-span-1")}>
      <span className="truncate text-xs text-muted-ink">{label}</span>
      <span className="truncate font-display text-lg font-semibold lg:text-xl">{value}</span>
      {sub && <span className="truncate text-xs text-muted-ink">{sub}</span>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="card px-5 py-9 text-center text-[15px] text-muted-ink">{children}</div>;
}
