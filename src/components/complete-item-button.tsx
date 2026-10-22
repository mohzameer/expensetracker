"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { setItemCompleteAction } from "@/server/actions";
import { formatAmount } from "@/lib/money";
import { cn } from "@/lib/utils";

/**
 * Desktop only: mark a due monthly item done for this month although less than planned
 * was paid (or undo it). The rest stops counting as due, and whatever of it is still
 * free in the category comes off the cap.
 */
export function CompleteItemButton({
  itemId,
  name,
  ym,
  complete,
  className,
}: {
  itemId: string;
  name: string;
  ym: string;
  /** true = "Complete", false = "Undo". */
  complete: boolean;
  className?: string;
}) {
  const [pending, start] = useTransition();

  const run = (value: boolean) =>
    start(async () => {
      const res = await setItemCompleteAction({ itemId, ym, complete: value });
      if (!res.ok) return void toast.error(res.error);
      if (value) {
        const freed = res.data.released > 0 ? ` · ${formatAmount(res.data.released)} off the cap` : "";
        toast(`${name} is done for this month${freed}`, { action: { label: "Undo", onClick: () => run(false) } });
      }
      else toast(`${name} is due again`);
    });

  return (
    <button
      type="button"
      onClick={() => run(complete)}
      disabled={pending}
      title={complete ? "Done for this month: stop counting the rest as due" : "Count the rest as due again"}
      className={cn(
        "hidden min-h-9 items-center rounded-full border px-3.5 text-sm font-semibold disabled:opacity-60 lg:inline-flex",
        complete ? "border-line-strong text-ink hover:bg-line-soft" : "border-transparent text-teal hover:bg-teal-wash",
        className,
      )}
    >
      {complete ? "Complete" : "Undo"}
    </button>
  );
}
