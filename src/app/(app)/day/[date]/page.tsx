import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { DayView } from "@/components/day/day-view";
import { formatDay, isIsoDate } from "@/lib/dates";
import { getDayView, touchCurrentMonth } from "@/server/queries";

export async function generateMetadata({ params }: PageProps<"/day/[date]">): Promise<Metadata> {
  const { date } = await params;
  return { title: isIsoDate(date) ? formatDay(date) : "Day" };
}

export default async function DayPage({ params }: PageProps<"/day/[date]">) {
  const { date } = await params;
  if (!isIsoDate(date)) notFound();
  const db = await getDb();
  await touchCurrentMonth(db);
  const data = await getDayView(db, date);
  return <DayView data={data} />;
}
