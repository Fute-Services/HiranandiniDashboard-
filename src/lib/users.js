/**
 * Accounts known to this app itself — none. Staff are Sperto's: they sign
 * in with an email or Sales ID the client's CRM vouches for
 * (server/routes/login.js), and nobody is pre-created here. The demo roster
 * that used to live in this array (staff@/admin@/manager@hiranandani.com) is
 * gone, so there is no way in that does not go through Sperto.
 *
 * Kept as an empty list, not deleted, because it is still the shape the rest
 * of the app reads: admin-created accounts (server/routes/users.js) are
 * merged with it, and lib/activity.js's `actorFields` looks names up in it.
 *
 * Three roles:
 * - admin: sees everything (every manager's and every staff member's activity).
 * - sales_manager: oversight only, reads *their own team's* sales staff
 *   session reports (via `managerEmail`).
 * - sales_staff: runs the actual client presentations.
 *
 * Roster only, never password hashes: this module ships in the browser
 * bundle. The server imports this same list (server/lib/users.js).
 */

/** @typedef {"admin" | "sales_manager" | "sales_staff"} Role */

export const USERS = [];

/** True for the first 30 days after `joiningDate` — unset means "not known
 * to be new," not "definitely not new," since existing mock staff don't have
 * a real join date on file. */
export function isNewJoiner(user, now) {
  if (!user?.joiningDate) return false;
  const joinedAt = new Date(user.joiningDate).getTime();
  if (Number.isNaN(joinedAt)) return false;
  return now - joinedAt < 30 * 24 * 60 * 60 * 1000;
}

export function findUserByEmail(email) {
  const normalized = email.trim().toLowerCase();
  return USERS.find((u) => u.email === normalized) ?? null;
}

/** Looks a static demo account up by its Sperto Sales ID (e.g. "PDPL0349")
 * rather than email — see the login route's Sales ID sign-in. Admin-created
 * accounts have their own sperto_login column in the `users` table, checked
 * separately since this array doesn't cover them (server/routes/users.js). */
export function findUserBySpertoLogin(spertoLogin) {
  const normalized = spertoLogin.trim().toLowerCase();
  return USERS.find((u) => u.spertoLogin?.toLowerCase() === normalized) ?? null;
}
