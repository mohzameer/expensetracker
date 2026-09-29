"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="font-display text-2xl font-semibold">Something went wrong</h1>
      <p className="text-[15px] text-muted-ink">
        {error.digest ? `Reference ${error.digest}. ` : ""}Your data is safe — nothing is saved halfway.
      </p>
      <button onClick={reset} className="mt-2 min-h-12 rounded-xl bg-ink px-6 text-[15px] font-semibold text-white">
        Try again
      </button>
    </div>
  );
}
