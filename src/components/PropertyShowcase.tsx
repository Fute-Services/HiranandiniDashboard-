"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Property } from "@/data/properties";
import { clearSessionCookies, getSession, LOGIN_PATH, SESSION_START_PATH } from "@/lib/auth";
import { getBlockedProjectsFor } from "@/lib/controls";
import { findUserByEmail } from "@/lib/users";
import {
  clearActiveSession,
  finalizeSession,
  getActiveSession,
  logSessionEvent,
  recordStepEnter,
  type ActiveSession,
} from "@/lib/session";
import { ImageSlot } from "./ImageSlot";
import styles from "./PropertyShowcase.module.css";

const VR_TOUR_URL = "https://futeservices.com/25-26/V2/VR_10/index.html";

const pad2 = (n: number) => String(n).padStart(2, "0");

function formatElapsed(ms: number) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${pad2(mins)}:${pad2(secs)}`;
}

/**
 * Where the Earth hands off to: the 360° VR tour plays fully sharp, always,
 * since the panorama is the visual lead. Property cards live in a frosted-glass
 * shelf along the bottom. It's a single screen, not a multi-step flow, so "End
 * Session" closes out and logs the visit (questionnaire §6) straight from
 * here, no separate feedback step required for V1.
 */
export function PropertyShowcase({ properties }: { properties: Property[] }) {
  const router = useRouter();
  const cardsRef = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [blockedSlugs, setBlockedSlugs] = useState<string[]>([]);

  useEffect(() => {
    const active = getActiveSession();
    if (!active) {
      router.replace(SESSION_START_PATH);
      return;
    }
    setSession(active);
    setIsAdmin(getSession()?.role === "admin");
    recordStepEnter("presentation");
  }, [router]);

  /** Lets an admin/manager block a project out of this staff member's
   * showcase mid-session (see SessionReports's Sales Staff/Projects panel
   * and `/api/controls`). Force-logout itself is handled globally by
   * `KickWatcher` (root layout) so it works on every page, not just this
   * one. Polls as a fallback, but also reacts instantly to visibilitychange
   * /focus, since background tabs throttle setInterval. */
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const email = getSession()?.email;
      const slugs = email ? await getBlockedProjectsFor(email) : [];
      if (!cancelled) setBlockedSlugs(slugs);
    };
    poll();
    const id = window.setInterval(poll, 2000);
    const onVisible = () => document.visibilityState === "visible" && poll();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", poll);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", poll);
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    setElapsedMs(Date.now() - session.startedAt);
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - session.startedAt);
    }, 1000);
    return () => window.clearInterval(id);
  }, [session]);

  const endSession = useCallback(() => {
    const staff = getSession();
    const managerEmail = staff ? findUserByEmail(staff.email)?.managerEmail ?? null : null;
    finalizeSession(0, "", staff?.name ?? "Unknown", managerEmail);
    router.push(SESSION_START_PATH);
  }, [router]);

  const signOut = useCallback(() => {
    clearActiveSession();
    clearSessionCookies();
    router.push(LOGIN_PATH);
    router.refresh();
  }, [router]);

  const scrollCards = useCallback((dir: 1 | -1) => {
    cardsRef.current?.scrollBy({ left: dir * 300, behavior: "smooth" });
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.vrBackdrop}>
        <iframe
          className={styles.vrFrame}
          src={VR_TOUR_URL}
          title="360° property tour"
          allow="gyroscope; accelerometer; xr-spatial-tracking"
        />
      </div>
      <div className={styles.topFade} />

      <header className={styles.header}>
        <div className={styles.leftGroup}>
          <div className={styles.brand}>
            <div className={styles.diamond} />
            <span className={styles.brandName}>Property Index</span>
            {session && <span className={styles.customer}>{session.lead.name}</span>}
          </div>
        </div>
        <div className={styles.headerRight}>
          {session && <span className={styles.timer}>{formatElapsed(elapsedMs)}</span>}
          {!isAdmin && (
            <button type="button" className={styles.endSession} onClick={endSession}>
              End Session
            </button>
          )}
          <button type="button" className={styles.signout} onClick={signOut}>
            Log out
          </button>
        </div>
      </header>

      <div className={styles.dock}>
        <button
          type="button"
          className={styles.navButton}
          onClick={() => scrollCards(-1)}
          aria-label="Scroll left"
        >
          &#8592;
        </button>

        <div className={styles.shelf}>
          <div className={styles.shelfLabel}>Hiranandani Portfolio &middot; 2026</div>
          <div className={styles.cards} ref={cardsRef}>
            {properties
              .filter((property) => !blockedSlugs.includes(property.slug))
              .map((property, i) => (
              <a
                key={property.slug}
                className={styles.card}
                href={property.href}
                target="_blank"
                rel="noreferrer"
                onClick={() => logSessionEvent(`Visited ${property.name || property.slug}`)}
              >
                <div className={styles.cardMedia}>
                  <ImageSlot
                    src={property.image}
                    placeholder={`${property.name || "Property"} image`}
                    alt={`${property.name || "Property"}, ${property.location}`}
                  />
                </div>
                <div className={styles.cardBody}>
                  <div className={styles.cardIndex}>{pad2(i + 1)}</div>
                  <h3 className={styles.cardName}>{property.name}</h3>
                  <span className={styles.cardLink}>Visit&nbsp;&#8599;</span>
                </div>
              </a>
            ))}
          </div>
        </div>

        <button
          type="button"
          className={styles.navButton}
          onClick={() => scrollCards(1)}
          aria-label="Scroll right"
        >
          &#8594;
        </button>
      </div>
    </div>
  );
}
