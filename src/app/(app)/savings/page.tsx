import type { Metadata } from "next";
import { getDb } from "@/db";
import { SavingsView } from "@/components/savings/savings-view";
import { getSavingsPage } from "@/server/queries";

export const metadata: Metadata = { title: "Savings" };

export default async function SavingsPage() {
  const data = await getSavingsPage(await getDb());
  return <SavingsView data={data} />;
}
