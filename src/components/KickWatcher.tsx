"use client";

import { useEffect, useRef, useState } from "react";
import { getSession, getSessionId, LOGIN_PATH } from "@/lib/auth";
import { ackKick, fetchControlState } from "@/lib/controls";
import { signOut } from "@/lib/sign-out";
import { FullScreenLoader } from "./Spinner";

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
  /** A force-logout tears the session down and navigates, all without the
   * staff member having touched anything — an overlay makes it clear the app
   * is doing something deliberate rather than freezing mid-presentation. It
   * ends when the page itself reloads (see lib/sign-out.ts). */
  const [signingOut, setSigningOut] = useState(false);
  /** The poll keeps ticking while the sign-out request is in flight, and
   * would otherwise start a second one on top of the first. */
  const ejectingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      // Runs for every signed-in session on every page, so a hidden-tab skip
      // matters here more than almost anywhere else in the app — this is the
      // single biggest multiplier across many concurrent staff.
      if (document.hidden || ejectingRef.current) return;
      const email = getSession()?.email;
      if (!email) return;
      const state = await fetchControlState(email, getSessionId() ?? undefined);
      if (cancelled || ejectingRef.current) return;
      if (state.kicked) {
        ejectingRef.current = true;
        setSigningOut(true);
        ackKick(email);
        // The query flag tells the login page why it's showing this staff
        // member the login form again, instead of a silent, unexplained
        // redirect.
        void signOut(`${LOGIN_PATH}?kicked=1`);
      } else if (state.sessionInvalid) {
        // A newer login for this account has taken over elsewhere — this tab
        // is stale, not force-logged-out, so it gets its own message rather
        // than the "an admin signed you out" one.
        ejectingRef.current = true;
        setSigningOut(true);
        void signOut(`${LOGIN_PATH}?replaced=1`);
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
  }, []);

  if (!signingOut) return null;
  return <FullScreenLoader message="Signing you out…" />;
}
