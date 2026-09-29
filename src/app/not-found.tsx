import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="font-display text-2xl font-semibold">Not found</h1>
      <p className="text-[15px] text-muted-ink">That page doesn&apos;t exist.</p>
      <Link href="/" className="mt-2 flex min-h-12 items-center rounded-xl bg-ink px-6 text-[15px] font-semibold text-white">
        Go to today
      </Link>
    </div>
  );
}
