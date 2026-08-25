import { fetchWithTimeout, readJsonSafe } from "./http";
import type { Role } from "./users";

/**
 * Session cookie names. The auth cookie itself is a signed, httpOnly token
 * issued by `/api/login` and verified by `middleware.ts` on every request
 * (see `src/lib/session-token.ts`) — the other four are plain, client-
 * readable cookies used only for display/attribution (which name to show,
 * which manager a staff member reports to), not for gating access.
 */
export const AUTH_COOKIE = "futeservices_auth";
/** Which mock account signed in, see src/lib/users.ts. */
export const ROLE_COOKIE = "futeservices_role";
export const NAME_COOKIE = "futeservices_name";
/** Needed to look a signed-in sales_staff member's manager back up (team scoping). */
export const EMAIL_COOKIE = "futeservices_email";
/** Groups every activity-log event (src/lib/activity.ts) from this login
 * until logout under one id, so the admin/manager timeline can tell distinct
 * login sessions apart. */
export const SESSION_ID_COOKIE = "futeservices_session_id";
export const AUTH_MAX_AGE = 60 * 60 * 24 * 7; // 7 days, in seconds
export const LOGIN_PATH = "/login";
/** Lead lookup + device picker, between the login and the showcase.
 * Staff-only. */
export const SESSION_START_PATH = "/session/start";
/** VR-tour backdrop + property showcase — the end of the staff flow. Staff-only. */
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

export type LoginResult =
  | { ok: true; role: Role; name: string; email: string; sessionId: string }
  | { ok: false; error: string };

/** What the caller is signing in with. Staff send the email alone — Sperto is
 * what verifies it (see src/app/api/login/route.ts). Admins and managers add a
 * password, because their dashboards are the ones worth protecting. */
export type LoginCredentials = { email: string; password?: string };

/** What /api/login's body may contain — every field optional, because a
 * failing or crashed route is exactly the case this type exists to survive.
 * Written out rather than derived from LoginResult: that's a union, and
 * `Partial<>` over a union keeps only the fields both members share. */
type LoginResponse = Partial<{
  role: Role;
  name: string;
  email: string;
  sessionId: string;
  error: string;
}>;

/** Calls the real login endpoint, which verifies the password (or, for the
 * demo buttons, just that the account exists) server-side and sets the
 * signed session cookie — see src/app/api/login/route.ts. Client-side only.
 * Surfaces the server's actual message on failure (e.g. "Your access has
 * been suspended...") rather than collapsing every failure into one
 * generic string. */
export async function login(credentials: LoginCredentials): Promise<LoginResult> {
  // Never throws, and never hangs. A failed sign-in is an ordinary outcome
  // the form already knows how to show, so every way this can go wrong — the
  // server down, a crashed route answering with an empty body, a body that
  // isn't the shape we expect, or a request that simply never comes back —
  // comes back as `ok: false` with something readable, rather than as a
  // rejected promise the login page would surface as a crash or, worse, as a
  // promise that never settles and leaves the button spinning forever.
  try {
    const res = await fetchWithTimeout("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(credentials),
    });
    const data = await readJsonSafe<LoginResponse>(res);
    if (!res.ok) {
      return { ok: false, error: data?.error ?? "Sign-in failed. Check the email and try again." };
    }
    // A 200 with a body we can't use is still a failed sign-in: letting it
    // through would hand the app a session with no role and break the
    // redirect that comes next instead of failing here, where we can say so.
    if (!data?.role || !data.name || !data.email || !data.sessionId) {
      return { ok: false, error: "Sign-in didn't complete. Please try again." };
    }
    return {
      ok: true,
      role: data.role,
      name: data.name,
      email: data.email,
      sessionId: data.sessionId,
    };
  } catch {
    return { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  }
}

/** Clears every session cookie, both the plain ones (directly) and the
 * httpOnly auth cookie (via /api/logout — client JS can't touch an httpOnly
 * cookie itself). Client-side only.
 *
 * Awaits that request rather than firing it off and moving on. Only the
 * server can expire the auth cookie, and `proxy.ts` reads exactly that cookie
 * to decide who's signed in — so a /login navigation that overtakes this
 * response gets bounced straight back to the dashboard, leaving the user
 * still signed in on a page that never navigated. Bounded by a timeout so a
 * slow or unreachable API delays sign-out instead of blocking it forever;
 * `keepalive` still covers the tab being closed mid-flight. */
export async function clearSessionCookies(): Promise<void> {
  const expire = "path=/; max-age=0; samesite=lax";
  document.cookie = `${ROLE_COOKIE}=; ${expire}`;
  document.cookie = `${NAME_COOKIE}=; ${expire}`;
  document.cookie = `${EMAIL_COOKIE}=; ${expire}`;
  document.cookie = `${SESSION_ID_COOKIE}=; ${expire}`;
  await Promise.race([
    fetchWithTimeout("/api/logout", { method: "POST", keepalive: true }).catch(() => {}),
    new Promise((resolve) => window.setTimeout(resolve, 1200)),
  ]);
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
