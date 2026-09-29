import type { Metadata } from "next";
import { getDb } from "@/db";
import { AccountsView } from "@/components/savings/accounts-view";
import { getMoneyPage } from "@/server/queries";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage() {
  const data = await getMoneyPage(await getDb());
  return <AccountsView data={data} />;
}
