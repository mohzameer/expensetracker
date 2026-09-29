export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-[480px] flex-col gap-4 px-4 py-6 lg:max-w-5xl lg:px-8" aria-busy="true" aria-label="Loading">
      <div className="h-11 w-48 animate-pulse rounded-xl bg-line-soft" />
      <div className="h-24 animate-pulse rounded-[18px] bg-line-soft" />
      <div className="h-40 animate-pulse rounded-[14px] bg-line-soft" />
      <div className="h-56 animate-pulse rounded-[14px] bg-line-soft" />
    </div>
  );
}
