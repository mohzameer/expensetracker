import type { Metadata } from "next";
import { createHash } from "node:crypto";
import { getDb } from "@/db";
import { SetupForm } from "@/components/setup/setup-form";
import { isYearMonth } from "@/lib/dates";
import { currentYm } from "@/server/domain/months";
import { getSetupPage } from "@/server/queries";

export const metadata: Metadata = { title: "Setup" };

export default async function SetupPage({ searchParams }: PageProps<"/setup">) {
  const { month } = await searchParams;
  const db = await getDb();
  const ym = typeof month === "string" && isYearMonth(month) ? month : await currentYm(db);
  const data = await getSetupPage(db, ym);
  // Remount the form whenever the saved data changes, so it starts from the truth.
  const version = createHash("sha1").update(JSON.stringify(data)).digest("hex");
  return <SetupForm key={version} data={data} />;
}
