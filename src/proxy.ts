import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  ADMIN_PATH,
  AUTH_COOKIE,
  DASHBOARD_PATH,
  INTRO_PATH,
  landingPathForRole,
  LOGIN_PATH,
  MANAGER_PATH,
  SESSION_START_PATH,
  SPACE_PATH,
} from "@/lib/auth";
import { verifySessionToken } from "@/lib/session-token";

/**
 * Gate every page behind the login, except the intro splash and the login
 * page itself, which stay public. An unauthenticated request to anything else
 * is bounced to the login; an already-authenticated request to the login page
 * lands wherever that role's flow starts (see `landingPathForRole`).
 *
 * There are three roles, so there are three separate areas. If a signed-in
 * user hits a route outside their own area, they get bounced to their own
 * landing page, same as if they weren't authed for it at all:
 * - admin: `/admin/dashboard` only, and sees every session and every role.
 * - sales_manager: `/manager/dashboard`, plus the client-presentation flow
 *   (`/session/start`, `/space`, `/dashboard`) to preview projects the same
 *   way a sales staff member would. They just don't get logged as "sales
 *   staff" on the resulting session (see `PropertyShowcase`'s `endSession`).
 * - sales_staff: the client-presentation flow (`/session/start`, `/space`,
 *   `/dashboard`) only, with no reporting access.
 *
 * The matcher below already spares Next internals and static assets, so this
 * only ever runs for real page navigations.
 *
 * Role comes from the verified token, not the separate (client-writable)
 * role cookie — that cookie is display-only now; it can't grant access on
 * its own even if someone edits it by hand.
 */
export async function proxy(req: NextRequest) {
  const token = req.cookies.get(AUTH_COOKIE)?.value;
  const secret = process.env.SESSION_SECRET;
  const payload = token && secret ? await verifySessionToken(token, secret) : null;
  const isAuthed = payload !== null;
  const role = payload?.role;
  const { pathname } = req.nextUrl;
  const isLoginPage = pathname === LOGIN_PATH;
  // /api/login and /api/logout must be reachable while signed out — that's
  // the whole point of them (you can't be authed yet to call /api/login).
  // /api/cron/* runs on Vercel's schedule, never in a signed-in browser
  // session — it authenticates itself via CRON_SECRET instead (see the
  // route), not our session cookie.
  const isPublicPage =
    isLoginPage ||
    pathname === INTRO_PATH ||
    pathname === "/api/login" ||
    pathname === "/api/logout" ||
    pathname.startsWith("/api/cron/");

  if (!isAuthed && !isPublicPage) {
    const url = req.nextUrl.clone();
    url.pathname = LOGIN_PATH;
    return NextResponse.redirect(url);
  }

  if (isAuthed && isLoginPage && role) {
    const url = req.nextUrl.clone();
    url.pathname = landingPathForRole(role);
    return NextResponse.redirect(url);
  }

  if (isAuthed && role && role !== "admin" && !isPublicPage) {
    const isAdminOnlyPage = pathname.startsWith(ADMIN_PATH);
    const isManagerOnlyPage = pathname.startsWith(MANAGER_PATH);
    const isStaffOnlyPage =
      pathname.startsWith(SESSION_START_PATH) ||
      pathname.startsWith(SPACE_PATH) ||
      pathname.startsWith(DASHBOARD_PATH);

    const outsideOwnArea =
      isAdminOnlyPage ||
      (isManagerOnlyPage && role !== "sales_manager") ||
      (isStaffOnlyPage && role !== "sales_staff" && role !== "sales_manager");

    if (outsideOwnArea) {
      const url = req.nextUrl.clone();
      url.pathname = landingPathForRole(role);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  // Skip Next internals, the favicon, and anything with a file extension
  // (images, fonts) so assets load without a session.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.).*)"],
};
