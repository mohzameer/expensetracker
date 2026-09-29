import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getIronSession } from "iron-session";
import { sessionOptions, type SessionData } from "./session";

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions());
}

/** Verify inside every page and Server Action — the proxy check is only optimistic. */
export async function requireSession() {
  const session = await getSession();
  if (!session.loggedIn) redirect("/login");
  return session;
}

export function passcodeMatches(input: string): boolean {
  const expected = process.env.APP_PASSCODE;
  if (!expected) throw new Error("APP_PASSCODE is not set");
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
