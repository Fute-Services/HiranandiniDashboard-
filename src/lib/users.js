/**
 * Mock account directory, stands in for Sperto/CRM-backed auth until the
 * client provides API docs and credentials (see the "Client Requirement
 * Discovery Questionnaire", §2 and §7). Swap the server's `findUser` for a
 * real API call when that lands; nothing else in the login flow should need
 * to change.
 *
 * Three roles:
 * - admin: sees everything (every manager's and every staff member's activity).
 * - sales_manager: oversight only, reads *their own team's* sales staff
 *   session reports (via `managerEmail` below) and doesn't run client
 *   presentations themselves.
 * - sales_staff: runs the actual client presentations (lead lookup to the
 *   VR/cards showcase), with no reporting access. Each is assigned to
 *   exactly one manager via `managerEmail`, and that's the "team" a manager's
 *   dashboard is scoped to.
 *
 * Roster only — no password hashes. This module is imported by client code
 * (lib/activity.js's `actorFields`, the reports' "New Joiner" badge) and so
 * ships in the browser bundle; the hashes live in `server/lib/passwords.js`,
 * which never does. Under Next.js both were in one file and both reached the
 * browser; splitting them is what that move is for.
 *
 * The server imports this same roster (see server/lib/users.js) so there is
 * still exactly one list of accounts, not two to drift apart.
 */

/** @typedef {"admin" | "sales_manager" | "sales_staff"} Role */

export const USERS = [
  {
    email: "admin@hiranandani.com",
    name: "Admin",
    role: "admin",
  },
  {
    email: "manager@hiranandani.com",
    name: "Priya Kulkarni",
    role: "sales_manager",
  },
  {
    email: "staff@hiranandani.com",
    name: "Sales Staff",
    role: "sales_staff",
    managerEmail: "manager@hiranandani.com",
    // Wired to a real Sperto login code so the device-usage integration
    // (server/lib/sperto-device-usage.js) is exercisable end-to-end via this
    // demo account, not just skipped for lack of one on file.
    spertoLogin: "PDPL0349",
  },
  {
    email: "aditya@hiranandani.com",
    name: "Aditya Rane",
    role: "sales_staff",
    managerEmail: "manager@hiranandani.com",
  },
  {
    email: "sneha@hiranandani.com",
    name: "Sneha Iyer",
    role: "sales_staff",
    managerEmail: "manager@hiranandani.com",
  },
];

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
