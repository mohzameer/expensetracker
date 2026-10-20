import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getDb } from "@/db";
import { MessagesGuide } from "@/components/setup/messages-guide";
import { APP_TIMEZONE } from "@/lib/dates";
import { getMessagesGuide } from "@/server/queries";

export const metadata: Metadata = { title: "Capture bank texts" };

export default async function MessagesSetupPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const data = await getMessagesGuide(await getDb());
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[640px] flex-col gap-5 px-4 py-5 lg:py-8">
      <div className="flex items-center gap-2">
        <Link href="/setup" aria-label="Back to setup" className="flex size-11 items-center justify-center rounded-full border border-line bg-surface">
          <ChevronLeft className="size-5" />
        </Link>
        <h1 className="font-display text-2xl font-semibold">Capture bank texts</h1>
      </div>
      <p className="m-0 text-sm leading-relaxed text-muted-ink">
        An iPhone automation forwards each bank text here. Purchases wait under <b>From messages</b> on Daily entry for a category;
        withdrawals and bank transfers wait under <b>Transfers</b>. Nothing counts until you log it.
      </p>
      <MessagesGuide
        endpoint={`${proto}://${host}/api/messages`}
        token={data.token}
        lastReceivedAt={
          data.lastReceivedAt?.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: APP_TIMEZONE }) ?? null
        }
      />
    </div>
  );
}
