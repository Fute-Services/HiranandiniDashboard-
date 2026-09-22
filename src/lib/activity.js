/**
 * Full sales-staff activity log (questionnaire "Admin & Sales Manager
 * Activity Tracking" goal): every login, search, customer lookup, and
 * project/property interaction, recorded as it happens rather than buffered
 * until sign-out, so a walkthrough is captured even when the tab closes
 * early.
 *
 * This writes to the browser, not to a server. There is no database behind
 * this app — the customer data is the client's and stays in their CRM — so
 * the log lives in the tab's own `sessionStorage`. See
 * `./activity-store.js` for what that costs: the log does not cross devices,
 * and it is editable by the person it is about. Cross-device control
 * (force-logout, suspension) is unaffected — that still goes through
 * `/api/controls`, which is a real server endpoint.
 */
import { appendEvent, listEvents } from "./activity-store";
import { getSession, getSessionId } from "./auth";
import { findUserByEmail } from "./users";

/**
 * Every kind of event the log can carry.
 *
 * - `project_close` is its own type, not a second `project_open`/
 *   `property_shown`: it isn't another thing shown to the customer, it's the
 *   end of one — and it's the only event carrying a *measured* dwell time for
 *   that project rather than the roadmap's inferred gap-to-next-event.
 *
 * @typedef {"login" | "logout" | "search" | "customer_profile" | "project_open"
 *   | "project_close" | "property_shown" | "tour_view" | "floor_plan"
 *   | "gallery" | "brochure_download" | "media_view" | "amenities" | "filter"
 *   | "notes" | "status" | "step" | "lead_merged" | "interest_level"
 *   | "lead_reassigned" | "phone_revealed" | "vr_load_failed"} ActivityType
 */

/** Generates a new per-login session id, stored in a cookie by the login
 * route so every event logged between login and logout carries the same id. */
export function newSessionId() {
  return crypto.randomUUID();
}

/**
 * Records one event. Never throws: a dropped log line shouldn't break the
 * sales flow, which is why every storage access inside `appendEvent` is
 * already guarded — this catch is the backstop for anything else.
 *
 * `event.device` is the staff-chosen device type (Tab/TV/Kiosk/…, see
 * lib/session.js) when the event happens inside a presentation session. It
 * falls back to the raw `navigator.userAgent` when omitted — a browser string
 * is still better than nothing for events outside a session (login, search).
 *
 * Synchronous now that the write is local. It used to be a `keepalive` fetch
 * whose whole point was surviving the page unload that follows a logout;
 * a `sessionStorage` write has already completed by the time it returns, so
 * that concern is gone rather than merely handled.
 */
export function track(event) {
  try {
    appendEvent({ ...event, device: event.device ?? navigator.userAgent });
  } catch {
    // best-effort; ignore
  }
}

/**
 * Reads the log back, filtered.
 *
 * Still async, and still resolving to `[]` rather than rejecting on any
 * failure: the dashboards call this on mount, on every filter change and on
 * a poll timer, and each of those clears a "Loading activity…" state in its
 * `.then()`. Keeping the promise means none of those call sites had to
 * change when the store moved into the browser.
 */
export async function listActivity(filters = {}) {
  try {
    return listEvents(filters);
  } catch {
    return [];
  }
}

/** Resolves the staff/manager fields every tracked event needs from just the
 * signed-in email, so call sites don't each re-derive it. */
export function actorFields(email, name) {
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
