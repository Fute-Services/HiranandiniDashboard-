import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  AUTH_COOKIE,
  AUTH_MAX_AGE,
  EMAIL_COOKIE,
  NAME_COOKIE,
  ROLE_COOKIE,
  SESSION_ID_COOKIE,
} from "@/lib/auth";
import { checkRateLimit, clientKey } from "@/lib/rate-limit";
import { isSameOrigin } from "@/lib/csrf";
import { getSql } from "@/lib/db";
import { withJsonErrors } from "@/lib/api";
import { signSessionToken } from "@/lib/session-token";
import { findUser, findUserByEmail } from "@/lib/users";

/**
 * Server-side login: password verification (and the password hashes
 * themselves) never reach the client bundle this way, unlike the previous
 * client-side `findUser` call. Also issues the signed session cookie
 * `middleware.ts` verifies on every request.
 *
 * `demo: true` skips the password check — this is what the login page's
 * one-click "DEMO MODE" buttons use, preserving that existing behavior
 * (there's no real credential to check for a demo click) without shipping
 * password hashes to the browser to make that decision.
 */
export const POST = withJsonErrors(async (req: NextRequest) => {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }

  const body = (await req.json()) as { email?: string; password?: string; demo?: boolean };
  const email = body.email?.trim().toLowerCase();
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });

  // Per-email is the real brute-force guard; per-IP is just a runaway-script
  // backstop and has to stay loose — a real sales office's staff all log in
  // from behind one shared/NAT'd IP, often within the same minute.
  if (!checkRateLimit(`login:${clientKey(req)}`, 100, 60_000) || !checkRateLimit(`login:${email}`, 10, 60_000)) {
    return NextResponse.json({ error: "Too many attempts, try again shortly." }, { status: 429 });
  }

  const user = body.demo ? findUserByEmail(email) : findUser(email, body.password ?? "");
  if (!user) return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });

  // A force-logout suspends login until an admin/manager explicitly
  // restores it (src/app/api/controls/route.ts's "restore" action) --
  // otherwise the staff member could just sign back in immediately.
  const sql = getSql();
  const rows = (await sql`
    SELECT login_suspended FROM staff_controls WHERE email = ${user.email}
  `) as { login_suspended: boolean }[];
  if (rows[0]?.login_suspended) {
    return NextResponse.json(
      { error: "Your access has been suspended. Contact your admin or sales manager to restore it." },
      { status: 403 },
    );
  }

  const sessionId = crypto.randomUUID();
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");

  const token = await signSessionToken(
    { email: user.email, role: user.role, name: user.name, exp: Date.now() + AUTH_MAX_AGE * 1000 },
    secret,
  );

  const res = NextResponse.json({ role: user.role, name: user.name, email: user.email, sessionId });
  const common = { path: "/", maxAge: AUTH_MAX_AGE, sameSite: "lax" as const };
  res.cookies.set(AUTH_COOKIE, token, { ...common, httpOnly: true });
  res.cookies.set(ROLE_COOKIE, user.role, common);
  // NextResponse's cookies.set() already URL-encodes the value — getSession()
  // (src/lib/auth.ts) does a single decodeURIComponent to match.
  res.cookies.set(NAME_COOKIE, user.name, common);
  res.cookies.set(EMAIL_COOKIE, user.email, common);
  res.cookies.set(SESSION_ID_COOKIE, sessionId, common);

  return res;
});
