import { useEffect } from "react";
import { Navigate } from "react-router-dom";
import { DASHBOARD_PATH } from "@/lib/auth";
import { getActiveSession } from "@/lib/session";
import { signOut } from "@/lib/sign-out";
import { FullScreenLoader } from "@/components/Spinner";

/**
 * There is no separate Lead ID / device screen any more: the login card asks
 * for Sales ID, Lead ID and device together (pages/LoginPage.jsx). This route
 * stays only because it is where a signed-in staff member lands — with a
 * presentation running they go back to it, without one they are signed out
 * to the login card to start one.
 */
export default function SessionStartPage() {
  const active = getActiveSession();

  useEffect(() => {
    if (!active) void signOut();
  }, [active]);

  if (active) return <Navigate to={DASHBOARD_PATH} replace />;
  return <FullScreenLoader message="Signing out…" />;
}
