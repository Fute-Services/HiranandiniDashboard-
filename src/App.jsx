import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { KickWatcher } from "@/components/KickWatcher";
import { IdleLogoutWatcher } from "@/components/IdleLogoutWatcher";
import { RedirectIfAuthed, RequireAuth } from "@/routes/guards";
import {
  ADMIN_PATH,
  DASHBOARD_PATH,
  LOGIN_PATH,
  MANAGER_PATH,
  SESSION_START_PATH,
} from "@/lib/auth";
import LoginPage from "@/pages/LoginPage";
import SessionStartPage from "@/pages/SessionStartPage";
import DashboardPage from "@/pages/DashboardPage";
import AdminDashboardPage from "@/pages/AdminDashboardPage";
import ManagerDashboardPage from "@/pages/ManagerDashboardPage";

/**
 * The app shell — what Next.js's root layout used to be, minus the parts the
 * framework owned: fonts are loaded in index.html and the global stylesheet is
 * imported by main.jsx.
 *
 * The two watchers are mounted once, here, rather than per page, so a
 * force-logout (KickWatcher) or an idle timeout (IdleLogoutWatcher) takes
 * effect on whichever screen the staff member happens to be on. They render
 * nothing until they actually fire.
 */
export default function App() {
  return (
    <BrowserRouter>
      <KickWatcher />
      <IdleLogoutWatcher />
      <Routes>
        <Route
          path={LOGIN_PATH}
          element={
            <RedirectIfAuthed>
              <LoginPage />
            </RedirectIfAuthed>
          }
        />

        <Route element={<RequireAuth />}>
          <Route path={SESSION_START_PATH} element={<SessionStartPage />} />
          <Route path={DASHBOARD_PATH} element={<DashboardPage />} />
          <Route path={ADMIN_PATH} element={<AdminDashboardPage />} />
          <Route path={MANAGER_PATH} element={<ManagerDashboardPage />} />
        </Route>

        {/* There is no landing page any more — the app is a sign-in-and-present
            tool, so the root just hands off to the login, which in turn bounces
            an already signed-in user to their own area. Any unknown path does
            the same rather than showing a 404 nobody can act on. */}
        <Route path="*" element={<Navigate to={LOGIN_PATH} replace />} />
      </Routes>
    </BrowserRouter>
  );
}
