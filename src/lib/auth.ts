import type { Role } from "./users";

/**
 * Client-side session flags. There's no auth backend yet, so "signed in" is
 * just cookies the login page sets and the middleware/pages check, which is
 * enough to gate the UI and branch on role. Replace with a real, server-verified
 * session when a backend (Sperto or otherwise) lands.
 */
export const AUTH_COOKIE = "hiranandani_auth";
/** Which mock account signed in, see src/lib/users.ts. */
export const ROLE_COOKIE = "hiranandani_role";
export const NAME_COOKIE = "hiranandani_name";
/** Needed to look a signed-in sales_staff member's manager back up (team scoping). */
export const EMAIL_COOKIE = "hiranandani_email";
/** Groups every activity-log event (src/lib/activity.ts) from this login
 * until logout under one id, so the admin/manager timeline can tell distinct
 * login sessions apart. */
export const SESSION_ID_COOKIE = "hiranandani_session_id";
export const AUTH_MAX_AGE = 60 * 60 * 24 * 7; // 7 days, in seconds
export const LOGIN_PATH = "/login";
/** Intro splash, public and shown before login on every visit. */
export const INTRO_PATH = "/";
/** Lead lookup/capture, where sales staff start a presentation. Staff-only. */
export const SESSION_START_PATH = "/session/start";
/** Earth-approach transition, reached once a lead is active. Staff-only. */
export const SPACE_PATH = "/space";
/** VR-tour backdrop + property showcase the Earth hands off to. Staff-only. */
export const DASHBOARD_PATH = "/dashboard";
/** Admin-only reporting dashboard, covering every session and every role. */
export const ADMIN_PATH = "/admin/dashboard";
/** Sales-manager-only reporting dashboard, scoped to their own team's sessions. */
export const MANAGER_PATH = "/manager/dashboard";

/** Where a freshly signed-in (or already-authed) user of this role lands. */
export function landingPathForRole(role: Role): string {
  if (role === "admin") return ADMIN_PATH;
  if (role === "sales_manager") return MANAGER_PATH;
  return SESSION_START_PATH;
}

/** Sets every session cookie a fresh sign-in needs, including a fresh
 * activity-log session id. Client-side only. Returns that session id so the
 * caller can log the "login" activity event against it immediately. */
export function setSessionCookies(role: Role, name: string, email: string): string {
  const opts = `path=/; max-age=${AUTH_MAX_AGE}; samesite=lax`;
  const sessionId = crypto.randomUUID();
  document.cookie = `${AUTH_COOKIE}=1; ${opts}`;
  document.cookie = `${ROLE_COOKIE}=${role}; ${opts}`;
  document.cookie = `${NAME_COOKIE}=${encodeURIComponent(name)}; ${opts}`;
  document.cookie = `${EMAIL_COOKIE}=${encodeURIComponent(email)}; ${opts}`;
  document.cookie = `${SESSION_ID_COOKIE}=${sessionId}; ${opts}`;
  return sessionId;
}

/** Clears every session cookie. Client-side only. */
export function clearSessionCookies() {
  const expire = "path=/; max-age=0; samesite=lax";
  document.cookie = `${AUTH_COOKIE}=; ${expire}`;
  document.cookie = `${ROLE_COOKIE}=; ${expire}`;
  document.cookie = `${NAME_COOKIE}=; ${expire}`;
  document.cookie = `${EMAIL_COOKIE}=; ${expire}`;
  document.cookie = `${SESSION_ID_COOKIE}=; ${expire}`;
}

/** The current login session's activity-log id (see SESSION_ID_COOKIE), or
 * null before any sign-in has set one. Client-side only. */
export function getSessionId(): string | null {
  return readCookie(SESSION_ID_COOKIE) ?? null;
}

function readCookie(name: string): string | undefined {
  return document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

/** Reads the signed-in user's role/name/email back out of the cookies. Client-side only. */
export function getSession(): { role: Role; name: string; email: string } | null {
  const role = readCookie(ROLE_COOKIE) as Role | undefined;
  const name = readCookie(NAME_COOKIE);
  const email = readCookie(EMAIL_COOKIE);
  if (!role || !name || !email) return null;
  return { role, name: decodeURIComponent(name), email: decodeURIComponent(email) };
}
