import type { Metadata } from "next";
import { createHash } from "node:crypto";
import { getDb } from "@/db";
import { SetupForm } from "@/components/setup/setup-form";
import { currentYearMonth, isYearMonth } from "@/lib/dates";
import { getSetupPage } from "@/server/queries";

export const metadata: Metadata = { title: "Setup" };

export default async function SetupPage({ searchParams }: PageProps<"/setup">) {
  const { month } = await searchParams;
  const ym = typeof month === "string" && isYearMonth(month) ? month : currentYearMonth();
  const data = await getSetupPage(await getDb(), ym);
  // Remount the form whenever the saved data changes, so it starts from the truth.
  const version = createHash("sha1").update(JSON.stringify(data)).digest("hex");
  return <SetupForm key={version} data={data} />;
}
