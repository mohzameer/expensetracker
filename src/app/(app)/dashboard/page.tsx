import type { Metadata } from "next";
import { getDb } from "@/db";
import { Dashboard } from "@/components/dashboard/dashboard";
import { currentYearMonth, isYearMonth, today } from "@/lib/dates";
import { getDashboard, touchCurrentMonth } from "@/server/queries";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const { month } = await searchParams;
  const ym = typeof month === "string" && isYearMonth(month) ? month : currentYearMonth();
  const db = await getDb();
  await touchCurrentMonth(db);
  return <Dashboard data={await getDashboard(db, ym)} today={today()} />;
}
