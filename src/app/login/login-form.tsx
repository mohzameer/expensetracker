"use client";

import { useActionState } from "react";
import { loginAction } from "@/server/actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="mt-8 flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />
      <label htmlFor="passcode" className="text-[13px] font-semibold text-muted-ink">
        Passcode
      </label>
      <input
        id="passcode"
        name="passcode"
        type="password"
        autoComplete="current-password"
        autoFocus
        required
        className="min-h-[52px] rounded-[14px] border border-line-strong bg-surface px-4 text-base outline-none focus:border-teal focus:ring-2 focus:ring-teal/20"
      />
      {state?.error && (
        <p role="alert" className="text-sm font-medium text-bad">
          {state.error}
        </p>
      )}
      <button
        disabled={pending}
        className="mt-2 min-h-14 rounded-2xl bg-ink text-[17px] font-semibold text-white disabled:opacity-60"
      >
        {pending ? "Checking…" : "Unlock"}
      </button>
    </form>
  );
}
