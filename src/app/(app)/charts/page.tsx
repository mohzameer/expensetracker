import type { Metadata } from "next";
import { getDb } from "@/db";
import { SpendingCharts } from "@/components/charts/spending-charts";
import { getSpending } from "@/server/queries";

export const metadata: Metadata = { title: "Spending" };

export default async function ChartsPage({ searchParams }: PageProps<"/charts">) {
  const { from } = await searchParams;
  // Only return to paths inside the app.
  const back = typeof from === "string" && from.startsWith("/") && !from.startsWith("//") ? from : "/";
  return <SpendingCharts data={await getSpending(await getDb())} back={back} />;
}
