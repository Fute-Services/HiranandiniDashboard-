/**
 * Client for the sales manager/staff directory (`/api/users`) — merges the
 * hardcoded demo accounts (src/lib/users.js) with admin-created accounts
 * stored in Postgres (scripts/db/schema.sql's `users` table). See
 * server/routes/users.js for why these can't just live in one array.
 *
 * A directory entry is `{ email, name, role, managerEmail, joiningDate,
 * spertoLogin }`, where `role` is "sales_manager" or "sales_staff" and the
 * last three are nullable.
 */
import { fetchWithTimeout, readJsonSafe } from "./http";

/** Every sales manager/staff account visible to the caller — admin sees
 * everyone, a sales manager sees only their own team plus themselves. Never
 * throws: a failed fetch reads the same as "nobody" to the caller. */
export async function listStaff() {
  try {
    const res = await fetchWithTimeout("/api/users");
    if (!res.ok) return [];
    const data = await readJsonSafe(res);
    return Array.isArray(data?.users) ? data.users : [];
  } catch {
    return [];
  }
}

/**
 * Creates an account. `input` is `{ name, email, password, role,
 * managerEmail?, spertoLogin? }` — `managerEmail` is required when role is
 * "sales_staff"; `spertoLogin` is Sperto's own login code for the account
 * (e.g. "PDPL0349", see server/lib/sperto-device-usage.js) and is optional,
 * since leaving it unset skips the device-usage call for that account rather
 * than sending a made-up value.
 */
export async function createStaff(input) {
  try {
    const res = await fetchWithTimeout("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await readJsonSafe(res);
    if (!res.ok) return { ok: false, error: data?.error ?? "Something went wrong." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Network error, please try again." };
  }
}
