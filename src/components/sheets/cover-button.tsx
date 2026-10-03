"use client";

import { useState } from "react";
import { CoverSheet } from "./cover-sheet";
import type { CategorySummary } from "@/server/queries";

/** A button that opens the cover sheet for one overspent category, for pages that aren't client components. */
export function CoverButton({
  target,
  summaries,
  currency,
  ym,
  className,
  children,
}: {
  target: CategorySummary;
  summaries: CategorySummary[];
  currency: string;
  ym: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [state, setState] = useState({ open: false, key: 0 });
  return (
    <>
      <button type="button" onClick={() => setState((s) => ({ open: true, key: s.key + 1 }))} className={className}>
        {children}
      </button>
      {state.key > 0 && (
        <CoverSheet
          key={state.key}
          open={state.open}
          onOpenChange={(open) => setState((s) => ({ ...s, open }))}
          target={target}
          summaries={summaries}
          currency={currency}
          ym={ym}
        />
      )}
    </>
  );
}
