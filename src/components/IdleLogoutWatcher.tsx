"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clearSessionCookies, getSession, LOGIN_PATH } from "@/lib/auth";
import { logLogout } from "@/lib/activity";
import { clearActiveSession } from "@/lib/session";
import { FullScreenLoader } from "./Spinner";
import styles from "./IdleLogoutWatcher.module.css";

const IDLE_LIMIT_MS = 30 * 60 * 1000; // 30 minutes
const WARNING_MS = 60 * 1000; // shows a countdown for the last 60s
const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "touchstart", "wheel", "scroll"] as const;

/**
 * Auto-signs a sales staff member out after 30 minutes with no mouse,
 * keyboard, touch, or scroll activity, warning them with a 60s countdown
 * first. Scoped to sales_staff only — a showcase device left mid-customer
 * walkthrough is the actual risk this covers, not an admin's own desk.
 * Mounted once at the root layout, same as KickWatcher, so it applies on
 * whichever page the staff member is currently on.
 */
export function IdleLogoutWatcher() {
  const router = useRouter();
  const pathname = usePathname();
  const lastActivityRef = useRef(Date.now());
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  /** Replaces the countdown card once the timer actually runs out, so the
   * last thing on screen isn't a frozen "0s" while the sign-out and the
   * redirect that follows it are still running. */
  const [signingOut, setSigningOut] = useState(false);

  const signOut = useCallback(() => {
    setSigningOut(true);
    logLogout();
    clearActiveSession();
    clearSessionCookies();
    router.push(LOGIN_PATH);
    router.refresh();
  }, [router]);

  // Mounted in the root layout, so it outlives the redirect it just fired —
  // clear the overlay once the login page is up, or it would cover it.
  useEffect(() => {
    setSigningOut(false);
  }, [pathname]);

  const stayActive = useCallback(() => {
    lastActivityRef.current = Date.now();
    setSecondsLeft(null);
  }, []);

  useEffect(() => {
    if (getSession()?.role !== "sales_staff") return undefined;

    const markActive = () => {
      lastActivityRef.current = Date.now();
      setSecondsLeft((s) => (s === null ? s : null));
    };
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, markActive, { passive: true }));

    const id = window.setInterval(() => {
      const remaining = IDLE_LIMIT_MS - (Date.now() - lastActivityRef.current);
      if (remaining <= 0) {
        signOut();
      } else if (remaining <= WARNING_MS) {
        setSecondsLeft(Math.ceil(remaining / 1000));
      }
    }, 1000);

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, markActive));
      window.clearInterval(id);
    };
  }, [signOut]);

  if (signingOut) return <FullScreenLoader message="Signing you out…" />;
  if (secondsLeft === null) return null;

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <div className={styles.title}>Still there?</div>
        <p className={styles.body}>
          You&rsquo;ve been inactive. Signing out in <strong>{secondsLeft}s</strong> to keep this session secure.
        </p>
        <button type="button" className={styles.stayBtn} onClick={stayActive}>
          Stay Signed In
        </button>
      </div>
    </div>
  );
}
