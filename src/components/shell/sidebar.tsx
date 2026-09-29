"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/server/actions";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", match: "/dashboard" },
  { href: "/", label: "Daily entry", match: "/day" },
  { href: "/setup", label: "Setup", match: "/setup" },
  { href: "/savings", label: "Accounts", match: "/savings" },
  { href: "/close", label: "Close month", match: "/close" },
];

/** Desktop-only navigation. Mobile is the day view and its sheets. */
export function Sidebar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col gap-1.5 border-r border-line px-4 py-7 lg:flex"
    >
      <Link href="/dashboard" className="px-3 pb-5 font-display text-[22px] font-semibold">
        Ledger
      </Link>
      {NAV.map((n) => {
        const active = pathname.startsWith(n.match) || (n.match === "/day" && pathname === "/");
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center rounded-[10px] px-3 text-[15px] transition-colors",
              active ? "bg-ink font-semibold text-white" : "hover:bg-line-soft",
            )}
          >
            {n.label}
          </Link>
        );
      })}
      <div className="flex-1" />
      <form action={logoutAction}>
        <button className="flex min-h-11 w-full items-center rounded-[10px] px-3 text-[15px] text-muted-ink hover:bg-line-soft">
          Lock
        </button>
      </form>
    </nav>
  );
}
