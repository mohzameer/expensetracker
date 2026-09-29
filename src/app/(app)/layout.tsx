import { requireSession } from "@/lib/auth";
import { Sidebar } from "@/components/shell/sidebar";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  await requireSession();
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
