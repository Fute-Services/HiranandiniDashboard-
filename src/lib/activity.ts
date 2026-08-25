/**
 * Full sales-staff activity log (questionnaire "Admin & Sales Manager
 * Activity Tracking" goal): every login, search, customer lookup, and
 * project/property interaction, streamed live to `/api/activity` as it
 * happens rather than buffered until sign-out (so a walkthrough is
 * captured even if the tab closes early). Backed by the same in-memory
 * server store pattern as `src/lib/controls.ts` (no DB yet) — see that
 * file's comment for why this has to be server-side rather than
 * localStorage: a manager and a sales-staff member are on separate
 * browsers, and only an append-only server endpoint (no PATCH/DELETE route
 * exists) can guarantee sales staff can't edit or erase their own history.
 */
import { getSession, getSessionId } from "./auth";
import { fetchWithTimeout, readJsonSafe } from "./http";
import { findUserByEmail } from "./users";

export type ActivityType =
  | "login"
  | "logout"
  | "search"
  | "customer_profile"
  | "project_open"
  /** The staff member shut a project's site and came back to the showcase.
   * Its own type, not a second `project_open`/`property_shown`: it isn't
   * another thing shown to the customer, it's the end of one — and it's the
   * only event carrying a *measured* dwell time for that project rather than
   * the roadmap's inferred gap-to-next-event. */
  | "project_close"
  | "property_shown"
  | "tour_view"
  | "floor_plan"
  | "gallery"
  | "brochure_download"
  | "media_view"
  | "amenities"
  | "filter"
  | "notes"
  | "status"
  | "step"
  | "lead_merged"
  | "interest_level"
  | "lead_reassigned"
  | "phone_revealed"
  | "vr_load_failed";

export type ActivityEvent = {
  id: string;
  sessionId: string;
  staffEmail: string;
  staffName: string;
  managerEmail: string | null;
  leadId: string | null;
  leadName: string | null;
  type: ActivityType;
  label: string;
  at: number;
  durationMs: number | null;
  device: string | null;
  location: string | null;
};

export type NewActivityEvent = Omit<ActivityEvent, "id" | "at" | "device" | "location"> & {
  /** Staff-chosen device type (Tab/TV/Kiosk/…, see lib/session.ts), when the
   * event happens inside a presentation session. Falls back to the raw
   * `navigator.userAgent` when omitted — a browser string is still better
   * than nothing for events outside a session (login, search). */
  device?: string;
};

/** Generates a new per-login session id, stored in a cookie by lib/auth.ts
 * so every event logged between login and logout carries the same id. */
export function newSessionId(): string {
  return crypto.randomUUID();
}

/** Fire-and-forget log write. `keepalive` lets the logout call survive the
 * page unload that immediately follows it. Never throws: a dropped log line
 * shouldn't break the sales flow. */
export function track(event: NewActivityEvent) {
  try {
    fetchWithTimeout("/api/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...event, device: event.device ?? navigator.userAgent }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // best-effort; ignore
  }
}

export type ActivityFilters = {
  managerEmail?: string;
  staffEmail?: string;
  leadId?: string;
  project?: string;
  from?: number;
  to?: number;
};

/** Never throws and never hangs: the dashboards call this on mount, on every
 * filter change and on a poll timer, and each of those clears a "Loading
 * activity…" state in its `.then()`. A failed read degrades to "no rows"
 * (which the UI already renders); a read that never came back used to leave
 * the dashboard on its loading block indefinitely. */
export async function listActivity(filters: ActivityFilters = {}): Promise<ActivityEvent[]> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  try {
    const res = await fetchWithTimeout(`/api/activity?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await readJsonSafe<ActivityEvent[]>(res);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Resolves the staff/manager fields every tracked event needs from just the
 * signed-in email, so call sites don't each re-derive it. */
export function actorFields(email: string, name: string) {
  return {
    staffEmail: email,
    staffName: name,
    managerEmail: findUserByEmail(email)?.managerEmail ?? null,
  };
}

/** Logs "logout" for whoever is currently signed in. Called at every
 * sign-out point (PropertyShowcase, SessionStart, SessionReports,
 * KickWatcher's force-logout) right before the auth cookies are cleared, so
 * it still has a session to attribute the event to. No-ops if nobody's
 * signed in. */
export function logLogout() {
  const session = getSession();
  const sessionId = getSessionId();
  if (!session || !sessionId) return;
  track({
    sessionId,
    type: "logout",
    label: `${session.name} signed out`,
    leadId: null,
    leadName: null,
    durationMs: null,
    ...actorFields(session.email, session.name),
  });
}
