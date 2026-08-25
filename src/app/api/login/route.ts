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
import { getSql, hasDb } from "@/lib/db";
import { withJsonErrors } from "@/lib/api";
import { signSessionToken } from "@/lib/session-token";
import { findUser, findUserByEmail, findUserBySpertoLogin, type Role, type User } from "@/lib/users";
import { verifyPassword } from "@/lib/password";
import { isSpertoConfigured, spertoEmailExists, spertoSalesIdExists } from "@/lib/sperto";

/**
 * Server-side login. Password hashes never reach the client bundle, and this
 * is where the signed session cookie `proxy.ts` verifies on every request is
 * issued.
 *
 * Two doors:
 *
 * - **Staff** — `{ email }`, no password, where `email` may also be a Sperto
 *   Sales ID (e.g. "PDPL0349", the same code used as sales_manager_login on
 *   the device-usage calls — src/lib/sperto-device-usage.ts) rather than an
 *   actual email address; resolveEmailFromSalesId below turns that into the
 *   account's real email before anything else runs, so every check after it
 *   is identical either way. A sales staff member signs in in front of a
 *   customer on a shared showroom screen, where a password prompt is
 *   theatre. What replaces it is Sperto: the email is looked up in the
 *   client's CRM (src/lib/sperto.ts), and an email they don't have is a
 *   rejection. Sperto owns the staff list, so nobody has to pre-create
 *   accounts here.
 *
 * - **Password** — `{ email, password }`. Admins and sales managers get the
 *   reporting dashboards, which are worth a real credential, and their door is
 *   deliberately *not* Sperto-gated: an outage at the CRM must not be able to
 *   lock an admin out of their own dashboard.
 */

/** Admin-created accounts (see /api/users) live in the `users` table rather
 * than the static USERS array — checked only when the static lookup misses, so
 * every existing demo account keeps resolving exactly as before. */
async function findDbUserByEmail(email: string): Promise<User | null> {
  if (!hasDb()) return null;
  const sql = getSql();
  const rows = (await sql`
    SELECT email, password_hash, name, role, manager_email FROM users WHERE email = ${email}
  `) as { email: string; password_hash: string; name: string; role: Role; manager_email: string | null }[];
  const row = rows[0];
  if (!row) return null;
  return {
    email: row.email,
    passwordHash: row.password_hash,
    name: row.name,
    role: row.role,
    managerEmail: row.manager_email ?? undefined,
  };
}

/** Turns an email Sperto has vouched for into the account this app runs on.
 *
 * If we already know the address, that record wins — it carries the role and
 * the `managerEmail` the reporting dashboards scope teams by, which Sperto's
 * four-field world has no room for. An address we've never seen is still a
 * valid sign-in (that is the point of letting Sperto own the list); it just
 * lands as plain sales_staff with no team. */
async function accountFor(email: string, spertoName: string | null): Promise<User> {
  const known = findUserByEmail(email) ?? (await findDbUserByEmail(email));
  if (known) return known;
  return {
    email,
    passwordHash: "",
    name: spertoName ?? email.split("@")[0],
    role: "sales_staff",
  };
}

/** A Sales ID (e.g. "PDPL0349") has no "@", so that alone tells it apart from
 * an email address — checked against the same `sperto_login` column the
 * "+ Add Staff" form writes (static USERS array first, then the `users`
 * table for admin-created accounts), same split as /api/session/device-usage's
 * own lookup. Never throws: an unset DB just means no admin-created accounts
 * have a Sales ID on file yet, not a broken sign-in. */
async function resolveEmailFromSalesId(salesId: string): Promise<string | null> {
  const normalized = salesId.trim().toLowerCase();
  const staticMatch = findUserBySpertoLogin(normalized);
  if (staticMatch) return staticMatch.email;
  if (!hasDb()) return null;
  const sql = getSql();
  const rows = (await sql`SELECT email FROM users WHERE lower(sperto_login) = ${normalized}`) as {
    email: string;
  }[];
  return rows[0]?.email ?? null;
}

export const POST = withJsonErrors(async (req: NextRequest) => {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  }

  const body = (await req.json()) as { email?: string; password?: string };
  const rawIdentifier = body.email?.trim();
  const password = body.password ?? "";

  if (!rawIdentifier) {
    return NextResponse.json({ error: "Email or Sales ID required" }, { status: 400 });
  }

  const mode: "password" | "staff" = password ? "password" : "staff";

  // Only the passwordless staff door accepts a Sales ID — admin/manager
  // sign-in stays email-only, since those accounts aren't necessarily on
  // Sperto at all (see the file comment above).
  const isSalesIdLogin = mode === "staff" && !rawIdentifier.includes("@");
  let email: string;
  if (isSalesIdLogin) {
    // Resolves which account this Sales ID belongs to (so role/manager/name
    // come from the right record), but this alone is NOT the verification —
    // it's just our own `users.sperto_login` column, which is only as
    // trustworthy as whoever last edited it. The actual "does this Sales ID
    // exist" check is spertoSalesIdExists below, same live gate the email
    // door gets.
    const resolved = await resolveEmailFromSalesId(rawIdentifier);
    if (!resolved) {
      return NextResponse.json({ error: "That Sales ID isn't registered." }, { status: 401 });
    }
    email = resolved;
  } else {
    email = rawIdentifier.toLowerCase();
  }

  // Per-credential is the real brute-force guard; per-IP is a runaway-script
  // backstop and has to stay loose — a real sales office's staff all sign in
  // from behind one shared/NAT'd IP, often within the same minute. The staff
  // door is limited harder because what's typed there is an email address,
  // which is not a secret.
  const perEmailLimit = mode === "password" ? 10 : 5;
  if (
    !checkRateLimit(`login:${clientKey(req)}`, 100, 60_000) ||
    !checkRateLimit(`login:email:${email}`, perEmailLimit, 60_000)
  ) {
    return NextResponse.json({ error: "Too many attempts, try again shortly." }, { status: 429 });
  }

  let user: User;

  if (mode === "password") {
    const found =
      findUser(email, password) ??
      (await (async () => {
        const row = await findDbUserByEmail(email);
        return row && verifyPassword(password, row.passwordHash) ? row : null;
      })());
    if (!found) {
      return NextResponse.json({ error: "Incorrect email or password." }, { status: 401 });
    }
    user = found;
  } else if (isSpertoConfigured()) {
    // A Sales ID is checked against Sperto as the Sales ID itself, not the
    // email it resolved to — resolveEmailFromSalesId above only found which
    // local record to attribute the session to, it didn't confirm the ID is
    // real. That confirmation is this call.
    const check = isSalesIdLogin ? await spertoSalesIdExists(rawIdentifier) : await spertoEmailExists(email);
    if (!check.ok) {
      // An outage is not a wrong email/Sales ID. Answering 401 here would send
      // a staff member off to double-check something that was fine all along,
      // so the two get different statuses and different words.
      if (check.reason === "unavailable") {
        console.error("[login] Sperto check failed:", check.message);
        return NextResponse.json(
          {
            error: `Couldn't reach Sperto to verify your ${isSalesIdLogin ? "Sales ID" : "email"}. Try again in a moment.`,
          },
          { status: 503 },
        );
      }
      return NextResponse.json(
        { error: isSalesIdLogin ? "That Sales ID isn't registered in Sperto." : "That email isn't registered in Sperto." },
        { status: 401 },
      );
    }
    user = await accountFor(email, check.name);
  } else {
    // No Sperto credentials — a local demo instance. Fall back to the built-in
    // account list so the flow can still be walked through, but only for
    // sales_staff: admin and manager dashboards keep their password.
    const found = findUserByEmail(email) ?? (await findDbUserByEmail(email));
    if (!found || found.role !== "sales_staff") {
      return NextResponse.json({ error: "That email isn't set up for staff sign-in." }, { status: 401 });
    }
    user = found;
  }

  const sessionId = crypto.randomUUID();
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");

  // Both of the below are Postgres-only concerns, and this flow is meant to
  // run on dummy data with no database configured (see lib/db.ts's `hasDb`).
  // With a DB they behave exactly as before; without one, sign-in still works
  // and simply has no suspension list and no single-session enforcement.
  if (hasDb()) {
    const sql = getSql();
    // A force-logout suspends login until an admin/manager explicitly restores
    // it (src/app/api/controls/route.ts's "restore" action) — otherwise the
    // staff member could just sign back in immediately.
    const rows = (await sql`
      SELECT login_suspended FROM staff_controls WHERE email = ${user.email}
    `) as { login_suspended: boolean }[];
    if (rows[0]?.login_suspended) {
      return NextResponse.json(
        { error: "Your access has been suspended. Contact your admin or sales manager to restore it." },
        { status: 403 },
      );
    }

    // Records this login as the one true active session for the account, so a
    // second concurrent login elsewhere (see /api/controls's sessionInvalid
    // check) can eject this one instead of both silently coexisting.
    await sql`
      INSERT INTO staff_controls (email, kicked, blocked_projects, current_session_id)
      VALUES (${user.email}, false, '{}', ${sessionId})
      ON CONFLICT (email) DO UPDATE SET current_session_id = ${sessionId}
    `;
  }

  const token = await signSessionToken(
    { email: user.email, role: user.role, name: user.name, exp: Date.now() + AUTH_MAX_AGE * 1000 },
    secret,
  );

  const res = NextResponse.json({
    role: user.role,
    name: user.name,
    email: user.email,
    sessionId,
  });
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
