import { Router } from "express";
import {
  AUTH_COOKIE,
  AUTH_MAX_AGE,
  EMAIL_COOKIE,
  NAME_COOKIE,
  REPORTING_ENABLED,
  ROLE_COOKIE,
  SESSION_ID_COOKIE,
} from "../lib/auth.js";
import { checkRateLimit, clientKey } from "../lib/rate-limit.js";
import { isSameOrigin } from "../lib/csrf.js";
import { getSql, hasDb } from "../lib/db.js";
import { cookieOptions, withJsonErrors } from "../lib/api.js";
import { signSessionToken } from "../lib/session-token.js";
import { findStaticUserWithHash, findUser, findUserBySpertoLogin } from "../lib/users.js";
import { verifyPassword } from "../lib/password.js";
import { isSpertoConfigured, spertoEmailExists, spertoSalesIdExists } from "../lib/sperto.js";

/**
 * Server-side login. Password hashes never reach the client bundle, and this
 * is where the signed session cookie the route guards verify is issued.
 *
 * Two doors:
 *
 * - **Staff** — `{ email }`, no password, where `email` may also be a Sperto
 *   Sales ID (e.g. "PDPL0349", the same code used as sales_manager_login on
 *   the device-usage calls — server/lib/sperto-device-usage.js) rather than
 *   an actual email address; resolveEmailFromSalesId below turns that into
 *   the account's real email before anything else runs, so every check after
 *   it is identical either way. A sales staff member signs in in front of a
 *   customer on a shared showroom screen, where a password prompt is
 *   theatre. What replaces it is Sperto: the email is looked up in the
 *   client's CRM (server/lib/sperto.js), and an email they don't have is a
 *   rejection. Sperto owns the staff list, so nobody has to pre-create
 *   accounts here.
 *
 * - **Password** — `{ email, password }`. Admins and sales managers get the
 *   reporting dashboards, which are worth a real credential, and their door is
 *   deliberately *not* Sperto-gated: an outage at the CRM must not be able to
 *   lock an admin out of their own dashboard.
 */
export const loginRouter = Router();

/** Admin-created accounts (see routes/users.js) live in the `users` table
 * rather than the static roster — checked only when the static lookup misses,
 * so every existing demo account keeps resolving exactly as before. */
async function findDbUserByEmail(email) {
  if (!hasDb()) return null;
  const sql = getSql();
  const rows = await sql`
    SELECT email, password_hash, name, role, manager_email FROM users WHERE email = ${email}
  `;
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
async function accountFor(email, spertoName) {
  const known = findStaticUserWithHash(email) ?? (await findDbUserByEmail(email));
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
 * "+ Add Staff" form writes (static roster first, then the `users` table for
 * admin-created accounts), same split as the device-usage route's own lookup.
 * Never throws: an unset DB just means no admin-created accounts have a Sales
 * ID on file yet, not a broken sign-in. */
async function resolveEmailFromSalesId(salesId) {
  const normalized = salesId.trim().toLowerCase();
  const staticMatch = findUserBySpertoLogin(normalized);
  if (staticMatch) return staticMatch.email;
  if (!hasDb()) return null;
  const sql = getSql();
  const rows = await sql`SELECT email FROM users WHERE lower(sperto_login) = ${normalized}`;
  return rows[0]?.email ?? null;
}

loginRouter.post(
  "/",
  withJsonErrors(async (req, res) => {
    if (!isSameOrigin(req)) {
      return res.status(403).json({ error: "Invalid origin" });
    }

    const body = req.body ?? {};
    const rawIdentifier = body.email?.trim();
    const password = body.password ?? "";

    if (!rawIdentifier) {
      return res.status(400).json({ error: "Email or Sales ID required" });
    }

    const mode = password ? "password" : "staff";

    // Only the passwordless staff door accepts a Sales ID — admin/manager
    // sign-in stays email-only, since those accounts aren't necessarily on
    // Sperto at all (see the file comment above).
    const isSalesIdLogin = mode === "staff" && !rawIdentifier.includes("@");
    let email;
    if (isSalesIdLogin) {
      // Resolves which account this Sales ID belongs to (so role/manager/name
      // come from the right record), but this alone is NOT the verification —
      // it's just our own `users.sperto_login` column, which is only as
      // trustworthy as whoever last edited it. The actual "does this Sales ID
      // exist" check is spertoSalesIdExists below, same live gate the email
      // door gets.
      const resolved = await resolveEmailFromSalesId(rawIdentifier);
      if (!resolved) {
        return res.status(401).json({ error: "That Sales ID isn't registered." });
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
      return res.status(429).json({ error: "Too many attempts, try again shortly." });
    }

    let user;

    if (mode === "password") {
      const found =
        findUser(email, password) ??
        (await (async () => {
          const row = await findDbUserByEmail(email);
          return row && verifyPassword(password, row.passwordHash) ? row : null;
        })());
      if (!found) {
        return res.status(401).json({ error: "Incorrect email or password." });
      }
      user = found;
    } else if (isSpertoConfigured()) {
      // A Sales ID is checked against Sperto as the Sales ID itself, not the
      // email it resolved to — resolveEmailFromSalesId above only found which
      // local record to attribute the session to, it didn't confirm the ID is
      // real. That confirmation is this call.
      const check = isSalesIdLogin
        ? await spertoSalesIdExists(rawIdentifier)
        : await spertoEmailExists(email);
      if (!check.ok) {
        // An outage is not a wrong email/Sales ID. Answering 401 here would send
        // a staff member off to double-check something that was fine all along,
        // so the two get different statuses and different words.
        if (check.reason === "unavailable") {
          console.error("[login] Sperto check failed:", check.message);
          return res.status(503).json({
            error: `Couldn't reach Sperto to verify your ${
              isSalesIdLogin ? "Sales ID" : "email"
            }. Try again in a moment.`,
          });
        }
        return res.status(401).json({
          error: isSalesIdLogin
            ? "That Sales ID isn't registered in Sperto."
            : "That email isn't registered in Sperto.",
        });
      }
      user = await accountFor(email, check.name);
    } else {
      // No Sperto credentials — a local demo instance. Fall back to the built-in
      // account list so the flow can still be walked through, but only for
      // sales_staff: admin and manager dashboards keep their password.
      const found = findStaticUserWithHash(email) ?? (await findDbUserByEmail(email));
      if (!found || found.role !== "sales_staff") {
        return res.status(401).json({ error: "That email isn't set up for staff sign-in." });
      }
      user = found;
    }

    // Reporting is out of scope for this release (see lib/auth.js's
    // REPORTING_ENABLED), so the two roles whose only destination was a
    // reporting dashboard have nowhere to sign in to. Refused here rather than
    // let through and bounced by the route guard: a session that lands on the
    // staff flow under an "admin" role would be logged and attributed as an
    // admin running presentations, which never happened.
    //
    // Deliberately after the password check, not before — answering "not
    // available" to a wrong password would confirm the account exists to
    // someone who hasn't proven they own it.
    if (!REPORTING_ENABLED && user.role !== "sales_staff") {
      return res.status(403).json({
        error: "Admin and manager sign-in isn't available. Use a sales staff account.",
      });
    }

    const sessionId = crypto.randomUUID();
    const secret = process.env.SESSION_SECRET;
    if (!secret) throw new Error("SESSION_SECRET is not set");

    // Both of the below are Postgres-only concerns, and this flow is meant to
    // run on dummy data with no database configured (see lib/db.js's `hasDb`).
    // With a DB they behave exactly as before; without one, sign-in still works
    // and simply has no suspension list and no single-session enforcement.
    if (hasDb()) {
      const sql = getSql();
      // A force-logout suspends login until an admin/manager explicitly restores
      // it (see routes/controls.js's "restore" action) — otherwise the staff
      // member could just sign back in immediately.
      const rows = await sql`
        SELECT login_suspended FROM staff_controls WHERE email = ${user.email}
      `;
      if (rows[0]?.login_suspended) {
        return res.status(403).json({
          error: "Your access has been suspended. Contact your admin or sales manager to restore it.",
        });
      }

      // Records this login as the one true active session for the account, so a
      // second concurrent login elsewhere (see routes/controls.js's
      // sessionInvalid check) can eject this one instead of both silently
      // coexisting.
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

    // maxAge is milliseconds on Express's res.cookie(), unlike the Set-Cookie
    // header's own `Max-Age` (seconds) that AUTH_MAX_AGE is written in.
    const common = cookieOptions({ maxAge: AUTH_MAX_AGE * 1000 });
    res.cookie(AUTH_COOKIE, token, { ...common, httpOnly: true });
    res.cookie(ROLE_COOKIE, user.role, common);
    // Passed raw: res.cookie() URL-encodes the value itself (its default
    // `encode`), exactly as NextResponse.cookies.set() used to, and
    // getSession() (src/lib/auth.js) does the single matching
    // decodeURIComponent on what document.cookie hands back. Encoding here
    // as well would double-encode a name with a space in it.
    res.cookie(NAME_COOKIE, user.name, common);
    res.cookie(EMAIL_COOKIE, user.email, common);
    res.cookie(SESSION_ID_COOKIE, sessionId, common);

    return res.json({
      role: user.role,
      name: user.name,
      email: user.email,
      sessionId,
    });
  }),
);
