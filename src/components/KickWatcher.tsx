"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { clearSessionCookies, getSession, LOGIN_PATH } from "@/lib/auth";
import { logLogout } from "@/lib/activity";
import { ackKick, fetchControlState } from "@/lib/controls";
import { clearActiveSession } from "@/lib/session";

/**
 * Mounted once at the root layout so a force-logout (see SessionReports's
 * Sales Staff panel) takes effect on whichever page the staff member is
 * actually on — lead lookup, the Earth transition, or the showcase — not
 * just the showcase screen. Polls `/api/controls` (see lib/controls.ts for
 * why this can't be localStorage: a manager and a sales-staff member are on
 * separate devices, so the "kicked" flag has to live somewhere reachable
 * from both, not in either one's own browser storage).
 */
export function KickWatcher() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      // Runs for every signed-in session on every page, so a hidden-tab skip
      // matters here more than almost anywhere else in the app — this is the
      // single biggest multiplier across many concurrent staff.
      if (document.hidden) return;
      const email = getSession()?.email;
      if (!email) return;
      const state = await fetchControlState(email);
      if (cancelled) return;
      if (state.kicked) {
        ackKick(email);
        logLogout();
        clearActiveSession();
        clearSessionCookies();
        // Tells the login page why it's showing this staff member the
        // login form again, instead of a silent, unexplained redirect.
        router.push(`${LOGIN_PATH}?kicked=1`);
        router.refresh();
      }
    };
    check();
    // 2s, not the old 8s — a force-logout should land on the login page
    // right away, not after a several-second lag. focus/visibilitychange
    // below still catches a kick instantly on switching back to this tab.
    const id = window.setInterval(check, 2000);
    const onVisible = () => document.visibilityState === "visible" && check();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return null;
}
