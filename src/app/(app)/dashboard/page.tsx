import type { Metadata } from "next";
import { getDb } from "@/db";
import { Dashboard } from "@/components/dashboard/dashboard";
import { isYearMonth, today } from "@/lib/dates";
import { currentYm } from "@/server/domain/months";
import { getDashboard, touchCurrentMonth } from "@/server/queries";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const { month } = await searchParams;
  const db = await getDb();
  const ym = typeof month === "string" && isYearMonth(month) ? month : await currentYm(db);
  await touchCurrentMonth(db);
  return <Dashboard data={await getDashboard(db, ym)} today={today()} />;
}
