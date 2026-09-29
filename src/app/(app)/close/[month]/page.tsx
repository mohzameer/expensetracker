import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { ClosePanel } from "@/components/close/close-panel";
import { formatMonth, isYearMonth } from "@/lib/dates";
import { getClosePage } from "@/server/queries";

export async function generateMetadata({ params }: PageProps<"/close/[month]">): Promise<Metadata> {
  const { month } = await params;
  return { title: isYearMonth(month) ? `Close ${formatMonth(month)}` : "Close month" };
}

export default async function ClosePage({ params }: PageProps<"/close/[month]">) {
  const { month } = await params;
  if (!isYearMonth(month)) notFound();
  const data = await getClosePage(await getDb(), month);
  return <ClosePanel data={data} />;
}
