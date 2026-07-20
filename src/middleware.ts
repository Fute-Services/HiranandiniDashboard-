import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, LOGIN_PATH } from "@/lib/auth";

/**
 * Gate every page behind the login. An unauthenticated request to anything but
 * the login page is bounced to it; an already-authenticated request to the
 * login page is bounced back to the index.
 *
 * The matcher below already spares Next internals and static assets, so this
 * only ever runs for real page navigations.
 */
export function middleware(req: NextRequest) {
  const isAuthed = req.cookies.get(AUTH_COOKIE)?.value === "1";
  const isLoginPage = req.nextUrl.pathname === LOGIN_PATH;

  if (!isAuthed && !isLoginPage) {
    const url = req.nextUrl.clone();
    url.pathname = LOGIN_PATH;
    return NextResponse.redirect(url);
  }

  if (isAuthed && isLoginPage) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Skip Next internals, the favicon, and anything with a file extension
  // (images, fonts) so assets load without a session.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.).*)"],
};
