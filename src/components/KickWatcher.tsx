"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { clearSessionCookies, getSession, LOGIN_PATH } from "@/lib/auth";
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
      const email = getSession()?.email;
      if (!email) return;
      const state = await fetchControlState(email);
      if (cancelled) return;
      if (state.kicked) {
        ackKick(email);
        clearActiveSession();
        clearSessionCookies();
        router.push(LOGIN_PATH);
        router.refresh();
      }
    };
    check();
    const id = window.setInterval(check, 2000);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [router]);

  return null;
}
