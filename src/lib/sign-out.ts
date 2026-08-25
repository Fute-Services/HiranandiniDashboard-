import { logLogout } from "./activity";
import { clearSessionCookies, LOGIN_PATH } from "./auth";
import { finalizeSession } from "./session";

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
 *
 * The navigation is also the one step that must happen no matter what, so
 * nothing before it is allowed to throw past this function. Two of the four
 * callers (KickWatcher, IdleLogoutWatcher) put a full-screen overlay up and
 * hand the rest to this promise; a throw on the way — sessionStorage refusing
 * to write on a locked-down device is the realistic one — used to leave that
 * overlay covering the whole app with nothing underneath it clickable and no
 * way out but a reload. Clearing local state is best-effort; leaving is not.
 */
export async function signOut(redirectTo: string = LOGIN_PATH): Promise<void> {
  try {
    logLogout();
    // finalizeSession rather than clearActiveSession: this is the only exit
    // every sign-out shares, and Sperto's "OUT" — with the session's
    // per-project times on it — has to go out on all of them, not just the
    // showcase's Log out button. An idle timeout or a force-logout ends the
    // presentation just as finally, and used to end it with Sperto still
    // believing the customer was in the room. finalizeSession sends at most
    // one "OUT" per presentation, so the showcase calling it first (to close
    // its timeline out while the session is still readable) and this call
    // arriving second is not a duplicate.
    finalizeSession();
    await clearSessionCookies();
  } catch {
    // Best-effort: the httpOnly auth cookie is what actually ends the
    // session, and a failure here still leaves the login page ahead.
  }
  window.location.replace(redirectTo);
}
