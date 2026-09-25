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
import { findUserByEmail as findStoredUser, findUserBySpertoLogin as findStoredBySpertoLogin, getControls, startSession } from "../lib/store.js";
import { cookieOptions, withJsonErrors } from "../lib/api.js";
import { signSessionToken } from "../lib/session-token.js";
import { findStaticUserWithHash, findUser, findUserBySpertoLogin } from "../lib/users.js";
import { verifyPassword } from "../lib/password.js";

/**
 * Server-side login. Password hashes never reach the client bundle, and this
 * is where the signed session cookie the route guards verify is issued.
 *
 * Two doors:
 *
 * - **Staff** — `{ email }`, no password, where `email` is the staff
 *   member's Sperto Sales ID (e.g. "PDPL0349"). Per the client, the only
 *   Sperto API this app calls is api_record_device_usage.php, so the Sales ID
 *   is not looked up anywhere: it is signed into the session and goes out as
 *   sales_manager_login on the IN/OUT calls (server/lib/sperto-device-usage.js).
 *   An email is refused, because it gives IN/OUT nothing to send.
 *
 * - **Password** — `{ email, password }`. Admins and sales managers get the
 *   reporting dashboards, which are worth a real credential, and their door is
 *   deliberately *not* Sperto-gated: an outage at the CRM must not be able to
 *   lock an admin out of their own dashboard.
 */
export const loginRouter = Router();

/** Admin-created accounts (see routes/users.js) live in the API's in-memory
 * store rather than the static roster — checked only when the static lookup
 * misses, so every existing demo account keeps resolving exactly as before. */
function findStoredUserByEmail(email) {
  const row = findStoredUser(email);
  if (!row) return null;
  return {
    email: row.email,
    passwordHash: row.passwordHash,
    name: row.name,
    role: row.role,
    managerEmail: row.managerEmail ?? undefined,
    spertoLogin: row.spertoLogin ?? undefined,
  };
}

/** The account a staff sign-in runs as: one we already know (it carries a
 * role and team), otherwise plain sales_staff under the Sales ID itself.
 * Nothing is stored. */
async function accountFor(email) {
  const known = findStaticUserWithHash(email) ?? findStoredUserByEmail(email);
  if (known) return known;
  return {
    email,
    passwordHash: "",
    name: email,
    role: "sales_staff",
  };
}

/** A Sales ID (e.g. "PDPL0349") has no "@", so that alone tells it apart from
 * an email address — checked against the same `spertoLogin` the
 * "+ Add Staff" form writes (static roster first, then the
 * in-memory store for admin-created accounts), same split as the
 * device-usage route's own lookup. An empty store just means no
 * admin-created account has a Sales ID on file yet, not a broken sign-in. */
function resolveEmailFromSalesId(salesId) {
  const normalized = salesId.trim().toLowerCase();
  const staticMatch = findUserBySpertoLogin(normalized);
  if (staticMatch) return staticMatch.email;
  return findStoredBySpertoLogin(normalized)?.email ?? null;
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

    if (mode === "staff" && rawIdentifier.includes("@")) {
      return res.status(400).json({ error: "Enter your Sales ID (e.g. PDPL0349), not an email." });
    }

    // Only the passwordless staff door accepts a Sales ID — admin/manager
    // sign-in stays email-only, since those accounts aren't necessarily on
    // Sperto at all (see the file comment above).
    const isSalesIdLogin = mode === "staff" && !rawIdentifier.includes("@");
    let email;
    if (isSalesIdLogin) {
      // Our store is only asked which account to attribute the session to;
      // a Sales ID it doesn't know signs in under the Sales ID itself.
      email = resolveEmailFromSalesId(rawIdentifier) ?? rawIdentifier.toUpperCase();
    } else {
      email = rawIdentifier.toLowerCase();
    }

    // Per-credential is the real brute-force guard; per-IP is a runaway-script
    // backstop and has to stay loose — a real sales office's staff all sign in
    // from behind one shared/NAT'd IP, often within the same minute. The staff
    // door is limited harder because what's typed there is an email address,
    // which is not a secret.
    //
    // The staff figure is deliberately not small. A showroom floor shares a
    // handful of accounts across every tablet, TV and kiosk on it, so the
    // same email signing in twenty times in a minute is a busy morning, not
    // an attack — and 5 turned that morning into "Too many attempts" on the
    // sixth device. What the limit is actually for here is keeping a script
    // from hammering Sperto's lookup, which 20 still does. The password door
    // stays tight, because what is typed there is a secret.
    const perEmailLimit = mode === "password" ? 10 : 20;
    if (
      !checkRateLimit(`login:${clientKey(req)}`, 300, 60_000) ||
      !checkRateLimit(`login:email:${email}`, perEmailLimit, 60_000)
    ) {
      return res.status(429).json({ error: "Too many attempts, try again shortly." });
    }

    let user;
    let spertoLogin = null;

    if (mode === "password") {
      const found =
        findUser(email, password) ??
        (() => {
          const row = findStoredUserByEmail(email);
          return row && verifyPassword(password, row.passwordHash) ? row : null;
        })();
      if (!found) {
        return res.status(401).json({ error: "Incorrect email or password." });
      }
      user = found;
    } else {
      user = await accountFor(email);
      // Sent as sales_manager_login on IN/OUT.
      spertoLogin = rawIdentifier.toUpperCase();
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

    // A force-logout suspends login until an admin/manager explicitly
    // restores it (see routes/controls.js's "restore" action) — otherwise the
    // staff member could just sign back in immediately.
    if (getControls(user.email).loginSuspended) {
      return res.status(403).json({
        error: "Your access has been suspended. Contact your admin or sales manager to restore it.",
      });
    }

    // Records this login as the one true active session for the account, so a
    // second concurrent login elsewhere (see routes/controls.js's
    // sessionInvalid check) can eject this one instead of both silently
    // coexisting.
    startSession(user.email, sessionId);

    const token = await signSessionToken(
      {
        email: user.email,
        role: user.role,
        name: user.name,
        ...(spertoLogin ? { spertoLogin } : {}),
        exp: Date.now() + AUTH_MAX_AGE * 1000,
      },
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
