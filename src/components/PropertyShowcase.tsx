"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Property } from "@/data/properties";
import { clearSessionCookies, getSession, LOGIN_PATH, SESSION_START_PATH } from "@/lib/auth";
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
            {properties.map((property, i) => (
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
