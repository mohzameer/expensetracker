import type { SessionOptions } from "iron-session";

export type SessionData = { loggedIn?: boolean };

export const SESSION_COOKIE = "ledger_session";

export function sessionOptions(): SessionOptions {
  const password = process.env.SESSION_SECRET;
  if (!password || password.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
  return {
    cookieName: SESSION_COOKIE,
    password,
    ttl: 60 * 60 * 24 * 180, // 180 days: this is a personal app on your own phone
    cookieOptions: { secure: process.env.NODE_ENV === "production", sameSite: "lax", httpOnly: true },
  };
}
