/**
 * Client for the sales manager/staff directory (`/api/users`) — merges the
 * hardcoded demo accounts (src/lib/users.ts) with admin-created accounts
 * stored in Postgres (scripts/db/schema.sql's `users` table). See
 * /api/users/route.ts for why these can't just live in one array.
 */
import { fetchWithTimeout, readJsonSafe } from "./http";

export type StaffUser = {
  email: string;
  name: string;
  role: "sales_manager" | "sales_staff";
  managerEmail: string | null;
  joiningDate: string | null;
};

/** Every sales manager/staff account visible to the caller — admin sees
 * everyone, a sales manager sees only their own team plus themselves. Never
 * throws: a failed fetch reads the same as "nobody" to the caller. */
export async function listStaff(): Promise<StaffUser[]> {
  try {
    const res = await fetchWithTimeout("/api/users");
    if (!res.ok) return [];
    const data = await readJsonSafe<{ users: StaffUser[] }>(res);
    return Array.isArray(data?.users) ? data.users : [];
  } catch {
    return [];
  }
}

export type CreateStaffInput = {
  name: string;
  email: string;
  password: string;
  role: "admin" | "sales_manager" | "sales_staff";
  /** Required when role is "sales_staff". */
  managerEmail?: string;
};

export async function createStaff(input: CreateStaffInput): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetchWithTimeout("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await readJsonSafe<{ ok?: boolean; error?: string }>(res);
    if (!res.ok) return { ok: false, error: data?.error ?? "Something went wrong." };
    return { ok: true };
  } catch {
    return { ok: false, error: "Network error — please try again." };
  }
}
