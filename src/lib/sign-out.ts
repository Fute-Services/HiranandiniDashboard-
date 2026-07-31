import { logLogout } from "./activity";
import { clearSessionCookies, LOGIN_PATH } from "./auth";
import { clearActiveSession } from "./session";

/**
 * The one way out of a session, shared by every sign-out point (the showcase,
 * lead lookup, both dashboards, and the force-logout and idle watchers) so
 * they can't drift apart on the one flow where getting the order wrong leaves
 * someone still signed in.
 *
 * Two things matter here, and both were wrong when each caller rolled its
 * own:
 *
 * 1. The auth cookie is httpOnly, so only /api/logout can expire it, and
 *    `proxy.ts` reads exactly that cookie. Navigating before that response
 *    lands means middleware still sees a valid session and bounces /login
 *    back to the dashboard — the sign-out silently fails. clearSessionCookies
 *    now waits for it.
 *
 * 2. A hard navigation, not router.push(). The push variant lands on the same
 *    route it started from when that bounce happens, so the component never
 *    unmounts and its "signing out…" state has nothing to clear it — the
 *    button spins forever. A full load can't get stuck that way: the page
 *    that owns the state is gone either way. replace() rather than assign()
 *    so Back doesn't return to a dashboard the user just left.
 */
export async function signOut(redirectTo: string = LOGIN_PATH): Promise<void> {
  logLogout();
  clearActiveSession();
  await clearSessionCookies();
  window.location.replace(redirectTo);
}
