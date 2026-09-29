import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { nextMonthToClose } from "@/server/queries";

export default async function CloseIndex() {
  redirect(`/close/${await nextMonthToClose(await getDb())}`);
}
