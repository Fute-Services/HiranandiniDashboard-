/**
 * Admin/sales-manager controls over sales staff and projects — thin client
 * for `/api/controls` (see that route for why this has to be a server-side
 * store rather than localStorage: cookies and localStorage are both scoped
 * to one browser profile, so a manager and a sales-staff member, who are on
 * separate devices in real use, need a shared channel that isn't tied to
 * either one's own browser storage).
 */

async function post(action: string, email: string, slug?: string) {
  await fetch("/api/controls", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, email, slug }),
  });
}

/** Admin/manager action: flags a sales_staff email for forced logout. */
export function kickStaff(email: string) {
  void post("kick", email);
}

/** Called by the kicked staff member's own tab once it's signed them out, so
 * the flag doesn't also block their next sign-in. */
export function ackKick(email: string) {
  void post("ack", email);
}

export function setProjectBlockedFor(staffEmail: string, slug: string, blocked: boolean) {
  void post(blocked ? "block" : "unblock", staffEmail, slug);
}

export type StaffControlState = { kicked: boolean; blockedProjects: string[] };

const EMPTY_STATE: StaffControlState = { kicked: false, blockedProjects: [] };

/** Single poll covering both flags for one staff email, so callers (the
 * kick watcher, the showcase's block filter) only make one request. */
export async function fetchControlState(email: string): Promise<StaffControlState> {
  try {
    const res = await fetch(`/api/controls?email=${encodeURIComponent(email)}`);
    if (!res.ok) return EMPTY_STATE;
    return (await res.json()) as StaffControlState;
  } catch {
    return EMPTY_STATE;
  }
}

export async function getBlockedProjectsFor(staffEmail: string): Promise<string[]> {
  return (await fetchControlState(staffEmail)).blockedProjects;
}
