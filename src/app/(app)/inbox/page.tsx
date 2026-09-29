import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getDb } from "@/db";
import { InboxList } from "@/components/inbox/inbox-list";
import { getInbox } from "@/server/queries";

export const metadata: Metadata = { title: "Needs category" };

export default async function InboxPage() {
  const data = await getInbox(await getDb());
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col gap-4 px-4 py-5 lg:py-8">
      <div className="flex items-center gap-2">
        <Link href="/" aria-label="Back to day view" className="flex size-11 items-center justify-center rounded-full border border-line bg-surface">
          <ChevronLeft className="size-5" />
        </Link>
        <h1 className="font-display text-2xl font-semibold">Needs category</h1>
      </div>
      <p className="text-sm leading-relaxed text-muted-ink">
        Saved without a category. They don&apos;t count against any budget until assigned, and a month can&apos;t close while any remain.
      </p>
      <InboxList data={data} />
    </div>
  );
}
