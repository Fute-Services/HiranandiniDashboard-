import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import {
  ADMIN_PATH,
  DASHBOARD_PATH,
  fetchViewer,
  landingPathForRole,
  LOGIN_PATH,
  MANAGER_PATH,
  REPORTING_ENABLED,
  SESSION_START_PATH,
} from "@/lib/auth";
import { getActiveSession } from "@/lib/session";
import { FullScreenLoader } from "@/components/Spinner";

/**
 * Gate every page behind the login, which is the only public page. An
 * unauthenticated request to anything else is bounced there; an
 * already-authenticated visit to the login page lands wherever that role's
 * flow starts (see `landingPathForRole`).
 *
 * There are three roles, so there are three separate areas. If a signed-in
 * user hits a route outside their own area, they get bounced to their own
 * landing page, same as if they weren't authed for it at all:
 * - admin: `/admin/dashboard` only, and sees every session and every role.
 * - sales_manager: `/manager/dashboard`, plus the client-presentation flow
 *   (`/session/start`, `/dashboard`) to preview projects the same way a sales
 *   staff member would. They just don't get logged as "sales staff" on the
 *   resulting session.
 * - sales_staff: the client-presentation flow (`/session/start`,
 *   `/dashboard`) only, with no reporting access.
 *
 * Under Next.js this was `src/proxy.ts`, middleware that verified the signed
 * session token on the server before a page was ever sent. A client-rendered
 * app has no such step, so the equivalent is this: ask the API who the signed
 * token says we are (`GET /api/session`), and render nothing until it
 * answers.
 *
 * The role therefore still comes from the verified token, not from the
 * separate (client-writable) role cookie — that cookie is display-only; it
 * can't grant access on its own even if someone edits it by hand.
 *
 * What this is *not* is the security boundary. The pages are static files a
 * browser can always fetch; the real enforcement is that every endpoint they
 * read checks the same cookie server-side (see `server/lib/viewer.js`). This
 * is about showing the right person the right screen.
 */

/** The last answer, kept for the life of the page. Every route change mounts
 * a guard afresh, and without this each one sat on "Checking your session…"
 * until /api/session answered again — it now renders at once from what is
 * already known and re-checks in the background. Sign-in and sign-out both
 * leave by hard navigation, which resets it. */
let lastViewer = null;

/** null = still asking, false = nobody, object = the verified viewer. */
function useViewer() {
  const [viewer, setViewer] = useState(lastViewer);

  useEffect(() => {
    let cancelled = false;
    fetchViewer().then((v) => {
      if (cancelled) return;
      // `null` means the API couldn't be reached: keep what was known rather
      // than treat a dropped request as a sign-out.
      if (v === null && lastViewer !== null) return;
      lastViewer = v ?? false;
      setViewer(lastViewer);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return viewer;
}

/** Everything that isn't the login page sits behind this. */
export function RequireAuth() {
  const viewer = useViewer();
  const location = useLocation();

  if (viewer === null) return <FullScreenLoader message="Checking your session…" />;
  if (viewer === false) return <Navigate to={LOGIN_PATH} replace />;

  // Reporting is out of scope for this release (see auth.js's
  // REPORTING_ENABLED). Both dashboards still exist as pages, so this is what
  // takes them off the app — and it has to sit above the role checks below,
  // which an admin skips entirely.
  const { pathname } = location;
  if (
    !REPORTING_ENABLED &&
    (pathname.startsWith(ADMIN_PATH) || pathname.startsWith(MANAGER_PATH))
  ) {
    return <Navigate to={landingPathForRole(viewer.role)} replace />;
  }

  if (viewer.role !== "admin") {
    const isAdminOnlyPage = pathname.startsWith(ADMIN_PATH);
    const isManagerOnlyPage = pathname.startsWith(MANAGER_PATH);
    const isStaffOnlyPage =
      pathname.startsWith(SESSION_START_PATH) || pathname.startsWith(DASHBOARD_PATH);

    const outsideOwnArea =
      isAdminOnlyPage ||
      (isManagerOnlyPage && viewer.role !== "sales_manager") ||
      (isStaffOnlyPage && viewer.role !== "sales_staff" && viewer.role !== "sales_manager");

    if (outsideOwnArea) return <Navigate to={landingPathForRole(viewer.role)} replace />;
  }

  return <Outlet />;
}

/**
 * The login page's own guard: already signed in means there is nothing to
 * sign in to, so go where this role's flow starts.
 */
export function RedirectIfAuthed({ children }) {
  const viewer = useViewer();

  if (viewer === null) return <FullScreenLoader message="Checking your session…" />;
  if (viewer === false) return children;

  // Staff only have somewhere to go while a presentation is running — the
  // login card is where one starts. Sending them on without one used to
  // bounce between here and /session/start's sign-out.
  if (viewer.role === "sales_staff") {
    return getActiveSession() ? <Navigate to={DASHBOARD_PATH} replace /> : children;
  }
  return <Navigate to={landingPathForRole(viewer.role)} replace />;
}
