/**
 * Admin/sales-manager controls over sales staff and projects — thin client
 * for `/api/controls` (see that route for why this has to be a server-side
 * store rather than localStorage: cookies and localStorage are both scoped
 * to one browser profile, so a manager and a sales-staff member, who are on
 * separate devices in real use, need a shared channel that isn't tied to
 * either one's own browser storage).
 */

/** Resolves true only if the server actually applied the change, so callers
 * that optimistically updated their own UI can roll back on failure rather
 * than showing a control state the server never accepted. */
import { fetchWithTimeout, readJsonSafe } from "./http";

async function post(action: string, email: string, slug?: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout("/api/controls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, email, slug }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Admin/manager action: flags a sales_staff email for forced logout. Also
 * suspends login (see /api/controls) -- restoreLogin is the only way back. */
export function kickStaff(email: string): Promise<boolean> {
  return post("kick", email);
}

/** Called by the kicked staff member's own tab once it's signed them out --
 * clears only the transient "eject now" flag. Login stays suspended. */
export function ackKick(email: string) {
  void post("ack", email);
}

/** Admin/manager action: lifts a login suspension left by a force-logout. */
export function restoreLogin(email: string): Promise<boolean> {
  return post("restore", email);
}

export function setProjectBlockedFor(
  staffEmail: string,
  slug: string,
  blocked: boolean,
): Promise<boolean> {
  return post(blocked ? "block" : "unblock", staffEmail, slug);
}

export type StaffControlState = { kicked: boolean; blockedProjects: string[]; loginSuspended: boolean };

const EMPTY_STATE: StaffControlState = { kicked: false, blockedProjects: [], loginSuspended: false };

/** Single poll covering both flags for one staff email, so callers (the
 * kick watcher, the showcase's block filter) only make one request.
 *
 * Always settles: callers gate a loading state on it (the showcase's Details
 * row, the staff panel's block grid), so a request that never came back used
 * to mean those controls never appeared at all. */
export async function fetchControlState(email: string): Promise<StaffControlState> {
  try {
    const res = await fetchWithTimeout(`/api/controls?email=${encodeURIComponent(email)}`);
    if (!res.ok) return EMPTY_STATE;
    const data = await readJsonSafe<Partial<StaffControlState>>(res);
    // Field-by-field rather than trusting the body wholesale: callers spread
    // `blockedProjects` straight into a .includes() check, so a missing or
    // malformed field has to land as the empty default, not as undefined.
    return {
      kicked: data?.kicked === true,
      blockedProjects: Array.isArray(data?.blockedProjects) ? data.blockedProjects : [],
      loginSuspended: data?.loginSuspended === true,
    };
  } catch {
    return EMPTY_STATE;
  }
}

export async function getBlockedProjectsFor(staffEmail: string): Promise<string[]> {
  return (await fetchControlState(staffEmail)).blockedProjects;
}
