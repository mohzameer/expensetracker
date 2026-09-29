/** Shown while a signed-in page loads: a branded splash on phones, a skeleton on desktop. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" role="status">
      <div className="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 lg:hidden">
        <svg viewBox="0 0 64 64" className="size-16 animate-[pulse_1.6s_ease-in-out_infinite]" aria-hidden>
          <rect width="64" height="64" rx="14" fill="#1F5F5B" />
          <path d="M22 16v32h22" fill="none" stroke="#F3F1EA" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="44" cy="22" r="5" fill="#E2682F" />
        </svg>
        <div className="flex flex-col items-center gap-1">
          <span className="font-display text-2xl font-semibold">Ledger</span>
          <span className="text-sm text-muted-ink">Loading your budget…</span>
        </div>
        <div className="h-1 w-32 overflow-hidden rounded-full bg-line-soft">
          <div className="h-full w-1/3 animate-[ledger-slide_1.1s_ease-in-out_infinite] rounded-full bg-teal" />
        </div>
      </div>

      <div className="mx-auto hidden w-full max-w-5xl flex-col gap-4 px-8 py-6 lg:flex">
        <div className="h-11 w-48 animate-pulse rounded-xl bg-line-soft" />
        <div className="h-24 animate-pulse rounded-[18px] bg-line-soft" />
        <div className="h-40 animate-pulse rounded-[14px] bg-line-soft" />
        <div className="h-56 animate-pulse rounded-[14px] bg-line-soft" />
      </div>
    </div>
  );
}
