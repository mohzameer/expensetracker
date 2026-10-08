import type { Metadata } from "next";
import { getDb } from "@/db";
import { AccountsView } from "@/components/savings/accounts-view";
import { getMoneyPage } from "@/server/queries";

export const metadata: Metadata = { title: "Accounts" };

export default async function AccountsPage({ searchParams }: PageProps<"/savings">) {
  const { from } = await searchParams;
  // Only return to paths inside the app.
  const back = typeof from === "string" && from.startsWith("/") && !from.startsWith("//") ? from : "/";
  const data = await getMoneyPage(await getDb());
  return <AccountsView data={data} back={back} />;
}
