import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db";
import { getSession } from "@/lib/auth";
import { isYearMonth } from "@/lib/dates";
import { toInputValue } from "@/lib/money";
import { getExportRows } from "@/server/queries";

const cell = (v: string | number | null) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** GET /api/export?month=YYYY-MM → CSV of expenses (all months without `month`). */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session.loggedIn) return new NextResponse("Unauthorized", { status: 401 });
  const month = request.nextUrl.searchParams.get("month");
  const ym = month && isYearMonth(month) ? month : null;
  const rows = await getExportRows(await getDb(), ym);
  const lines = [
    ["date", "category", "item", "kind", "amount", "note"].join(","),
    ...rows.map((r) =>
      [r.spentOn, r.categoryName, r.itemName, r.itemKind === "one_off" ? "one-off" : r.itemKind, toInputValue(r.amount), r.note].map(cell).join(","),
    ),
  ];
  return new NextResponse(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="expenses-${ym ?? "all"}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
