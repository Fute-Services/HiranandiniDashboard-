"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSession } from "@/lib/auth";
import { signOut } from "@/lib/sign-out";
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
  const lastActivityRef = useRef(Date.now());
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  /** Replaces the countdown card once the timer actually runs out, so the
   * last thing on screen isn't a frozen "0s" while the sign-out and the
   * reload that follows it are still running. */
  const [signingOut, setSigningOut] = useState(false);
  /** The countdown ticks every second and would otherwise fire a fresh
   * sign-out on each tick while the first one's request is still going. */
  const signingOutRef = useRef(false);

  const startSignOut = useCallback(() => {
    if (signingOutRef.current) return;
    signingOutRef.current = true;
    setSigningOut(true);
    void signOut();
  }, []);

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
        startSignOut();
      } else if (remaining <= WARNING_MS) {
        setSecondsLeft(Math.ceil(remaining / 1000));
      }
    }, 1000);

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, markActive));
      window.clearInterval(id);
    };
  }, [startSignOut]);

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
