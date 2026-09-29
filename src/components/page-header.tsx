import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addMonths, formatMonth } from "@/lib/dates";

/** Month switcher used by the desktop pages: ‹ September 2026 ›. */
export function MonthHeader({ ym, href, title, children }: { ym: string; href: (ym: string) => string; title?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <Link
          href={href(addMonths(ym, -1))}
          aria-label="Previous month"
          className="flex size-10 items-center justify-center rounded-full border border-line bg-surface"
        >
          <ChevronLeft className="size-[18px]" />
        </Link>
        <h1 className="font-display text-[26px] font-semibold lg:text-3xl">{title ?? formatMonth(ym)}</h1>
        <Link
          href={href(addMonths(ym, 1))}
          aria-label="Next month"
          className="flex size-10 items-center justify-center rounded-full border border-line bg-surface"
        >
          <ChevronRight className="size-[18px]" />
        </Link>
      </div>
      {children}
    </div>
  );
}
