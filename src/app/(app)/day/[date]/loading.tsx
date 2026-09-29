/** Moving between days: a skeleton in the shape of the day view, so nothing jumps. */
export default function DayLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading day"
      role="status"
      className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col gap-3.5 px-4 pt-5 lg:max-w-5xl lg:px-8 lg:py-6"
    >
      <div className="flex items-center justify-between">
        <div className="size-11 rounded-full border border-line bg-surface" />
        <div className="flex flex-col items-center gap-1.5">
          <div className="h-6 w-36 animate-pulse rounded-lg bg-line-soft" />
          <div className="h-3.5 w-14 animate-pulse rounded bg-line-soft" />
        </div>
        <div className="size-11 rounded-full border border-line bg-surface" />
      </div>
      <div className="h-[92px] animate-pulse rounded-[18px] bg-teal/80" />
      <div className="h-12 animate-pulse rounded-[14px] bg-line-soft" />
      <div className="mt-2 h-3.5 w-28 animate-pulse rounded bg-line-soft" />
      <div className="card flex flex-col divide-y divide-line-soft">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 px-3.5 py-3.5">
            <div className="flex flex-1 flex-col gap-1.5">
              <div className="h-4 w-28 animate-pulse rounded bg-line-soft" />
              <div className="h-3 w-20 animate-pulse rounded bg-line-soft" />
            </div>
            <div className="h-4 w-14 animate-pulse rounded bg-line-soft" />
          </div>
        ))}
      </div>
    </div>
  );
}
