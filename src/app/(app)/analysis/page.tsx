import type { Metadata } from "next";
import { getDb } from "@/db";
import { AnalysisView } from "@/components/analysis/analysis-view";
import { getAnalysis } from "@/server/queries";

export const metadata: Metadata = { title: "Analysis" };

export default async function AnalysisPage({ searchParams }: PageProps<"/analysis">) {
  const { from } = await searchParams;
  // Only return to paths inside the app.
  const back = typeof from === "string" && from.startsWith("/") && !from.startsWith("//") ? from : "/";
  return <AnalysisView data={await getAnalysis(await getDb())} back={back} />;
}
