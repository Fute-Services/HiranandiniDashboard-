/**
 * Server-side copies of the session constants.
 *
 * The client has its own set in `src/lib/auth.js`, and this file deliberately
 * does not import them: that module reaches for `document.cookie` and talks to
 * `/api/*`, so it is browser-only. These are the same names and the same
 * values, held where the routes that actually set and verify the cookies can
 * reach them.
 *
 * `REPORTING_ENABLED` in particular has to exist on both sides for a reason
 * that predates the split: a client-side constant can be edited in devtools,
 * so the route that issues sessions must not be taking the browser's word for
 * whether the admin and manager doors are open.
 */

export const AUTH_COOKIE = "futeservices_auth";
export const ROLE_COOKIE = "futeservices_role";
export const NAME_COOKIE = "futeservices_name";
export const EMAIL_COOKIE = "futeservices_email";
export const SESSION_ID_COOKIE = "futeservices_session_id";

export const AUTH_MAX_AGE = 60 * 60 * 24 * 7; // 7 days, in seconds

/** Whether the admin and sales-manager reporting dashboards are part of the
 * shipped app. Out of scope for this release; flip both this and the client's
 * copy to bring the whole thing back. */
export const REPORTING_ENABLED = false;
