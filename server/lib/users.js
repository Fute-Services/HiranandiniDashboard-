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

/** email -> `salt:hash` (scrypt), see ./password.js. Never a plaintext
 * password, and never anything the client can reach. */
const PASSWORD_HASHES = {
  // admin123
  "admin@hiranandani.com":
    "0c14dfb30c222d222a0e78f2daa8af18:0979c78b3b6a713bdf09022b14f1b82c4fbc3770261c1b8611f84f4365e68e427e88ccd55351e6cc42ba4e11b4712843b6d03b348f43cea9194efc4abad132d2",
  // manager123
  "manager@hiranandani.com":
    "ab9eedd6498fa9df1da2df9630f29740:3b8fb6b30d5d5d1c5d2fd1e4b1930efae54ac018bc925dab2f6bda338ed60444e98323256f13d262e5a420a7633251a3dd16e9152ca33cb23faeb73cc203b58f",
  // staff123
  "staff@hiranandani.com":
    "4644e62880d7921d78bf033a87f2da01:c4305fd8233a9961753343754031a441d878e4bc8986020c10a97ce884bf3f25e705eff26805f676a3b1cc910e69f2f6397f1d18ace7b260c048294100bd7da3",
  // staff123
  "aditya@hiranandani.com":
    "4644e62880d7921d78bf033a87f2da01:c4305fd8233a9961753343754031a441d878e4bc8986020c10a97ce884bf3f25e705eff26805f676a3b1cc910e69f2f6397f1d18ace7b260c048294100bd7da3",
  // staff123
  "sneha@hiranandani.com":
    "4644e62880d7921d78bf033a87f2da01:c4305fd8233a9961753343754031a441d878e4bc8986020c10a97ce884bf3f25e705eff26805f676a3b1cc910e69f2f6397f1d18ace7b260c048294100bd7da3",
};

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
