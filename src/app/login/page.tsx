import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-4xl font-semibold">Ledger</h1>
        <p className="mt-2 text-[15px] text-muted-ink">Budgets by category, spending by the day.</p>
        <LoginForm next={typeof next === "string" ? next : "/"} />
      </div>
    </main>
  );
}
