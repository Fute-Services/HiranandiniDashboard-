import { USERS as ROSTER, findUserByEmail, findUserBySpertoLogin } from "../../src/lib/users.js";
import { verifyPassword } from "./password.js";

/**
 * The account directory as the server sees it: the shared roster, plus the
 * password hashes, which never leave this side.
 *
 * The roster itself is imported from `src/lib/users.js` rather than copied,
 * so there is exactly one list of accounts. That file ships in the browser
 * bundle (the reports' "New Joiner" badge and lib/activity.js's `actorFields`
 * both read it), which is precisely why the hashes are down here instead —
 * under Next.js the two lived in one module and the hashes reached the
 * browser along with everything else.
 *
 * Swap `findUser` for a real API call when the client's CRM auth lands;
 * nothing else in the login flow should need to change.
 */

/** email -> `salt:hash` (scrypt), see ./password.js. Empty: the demo
 * accounts and their passwords were removed, so no static account can sign
 * in with a password. */
const PASSWORD_HASHES = {};

/** The roster with each account's hash attached — the shape the login route
 * works in, where a "user" always has a `passwordHash` whether it came from
 * here or from the `users` table. */
export const USERS = ROSTER.map((u) => ({ ...u, passwordHash: PASSWORD_HASHES[u.email] ?? "" }));

export { findUserByEmail, findUserBySpertoLogin };

/** A static demo account with its hash, or null. Separate from
 * `findUserByEmail` (which answers from the shared roster and has no hash on
 * it) because only the login route has any business seeing one. */
export function findStaticUserWithHash(email) {
  const normalized = email.trim().toLowerCase();
  return USERS.find((u) => u.email === normalized) ?? null;
}

export function findUser(email, password) {
  const user = findStaticUserWithHash(email);
  if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) return null;
  return user;
}
