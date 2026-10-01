"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { SlidersHorizontal } from "lucide-react";
import { Sheet } from "@/components/sheets/sheet";
import { setChartHiddenCategoriesAction } from "@/server/actions";
import { cn } from "@/lib/utils";

type Category = { id: string; name: string; color: string };

/**
 * "Filter" button for the spending charts: untick categories to leave them out.
 * The choice is saved to your account, so every device shows the same charts.
 */
export function ChartFilter({
  categories,
  hidden,
  onPreview,
}: {
  categories: Category[];
  hidden: string[];
  /** Apply the choice on screen straight away (before the save round-trip). */
  onPreview?: (hidden: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(new Set(hidden));
  const [pending, start] = useTransition();
  const known = new Set(categories.map((c) => c.id));
  const hiddenCount = hidden.filter((id) => known.has(id)).length;

  const save = () => {
    const ids = [...draft];
    onPreview?.(ids);
    setOpen(false);
    start(async () => {
      const res = await setChartHiddenCategoriesAction(ids);
      if (!res.ok) return void toast.error(res.error);
      toast.success(ids.length ? `Charts leave out ${ids.length} ${ids.length === 1 ? "category" : "categories"}` : "Charts show every category");
    });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setDraft(new Set(hidden));
          setOpen(true);
        }}
        disabled={pending}
        className={cn(
          "flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold",
          hiddenCount ? "border-teal bg-teal-wash text-teal" : "border-line-strong text-ink",
        )}
      >
        <SlidersHorizontal aria-hidden className="size-3.5" />
        {hiddenCount ? `${hiddenCount} hidden` : "Filter"}
      </button>

      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Categories in charts"
        description={<span className="text-muted-ink">Untick the ones to leave out, like big fixed payments. Saved for all your devices.</span>}
      >
        <ul className="flex max-h-[50dvh] flex-col overflow-y-auto rounded-xl border border-line">
          {categories.map((c) => {
            const shown = !draft.has(c.id);
            return (
              <li key={c.id} className="border-b border-line-soft last:border-0">
                <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3.5">
                  <input
                    type="checkbox"
                    checked={shown}
                    onChange={() =>
                      setDraft((d) => {
                        const next = new Set(d);
                        if (shown) next.add(c.id);
                        else next.delete(c.id);
                        return next;
                      })
                    }
                    className="size-[18px] accent-teal"
                  />
                  <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
                  <span className={cn("flex-1 text-[15px]", !shown && "text-muted-ink line-through")}>{c.name}</span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => setDraft(new Set())}
            className="min-h-14 rounded-2xl border border-line-strong px-5 text-base font-medium"
          >
            Show all
          </button>
          <button type="button" onClick={save} className="min-h-14 flex-1 rounded-2xl bg-ink text-[17px] font-semibold text-white">
            Save
          </button>
        </div>
      </Sheet>
    </>
  );
}
