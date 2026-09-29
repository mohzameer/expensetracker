import { NextResponse, type NextRequest } from "next/server";
import { unsealData } from "iron-session";
import { SESSION_COOKIE, sessionOptions, type SessionData } from "@/lib/session";

// Optimistic check only: pages and actions verify the session themselves.
export async function proxy(request: NextRequest) {
  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (cookie) {
    const opts = sessionOptions();
    const data = await unsealData<SessionData>(cookie, { password: opts.password, ttl: opts.ttl }).catch(() => ({}) as SessionData);
    if (data.loggedIn) return NextResponse.next();
  }
  const url = new URL("/login", request.url);
  if (request.nextUrl.pathname !== "/") url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest).*)"],
};
