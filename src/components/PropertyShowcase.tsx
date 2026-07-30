"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Property } from "@/data/properties";
import { clearSessionCookies, getSession, LOGIN_PATH, SESSION_START_PATH } from "@/lib/auth";
import { logLogout } from "@/lib/activity";
import { getBlockedProjectsFor } from "@/lib/controls";
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
  const [noteText, setNoteText] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);
  const [detailsProperty, setDetailsProperty] = useState<Property | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const active = getActiveSession();
    if (!active) {
      router.replace(SESSION_START_PATH);
      return;
    }
    setSession(active);
    setIsAdmin(getSession()?.role === "admin");
    recordStepEnter("presentation");
    logSessionEvent("360° VR tour opened", "tour_view");
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

  // A block that lands while that exact project's details modal is already
  // open wouldn't otherwise do anything — blockedSlugs only filters the
  // card/button lists a staff member picks from, not a modal already
  // rendered from a click made before the block. Force it shut the moment
  // its slug shows up blocked, so mid-session blocking is actually
  // immediate, not just "can't open it again."
  useEffect(() => {
    setDetailsProperty((current) =>
      current && blockedSlugs.includes(current.slug) ? null : current,
    );
  }, [blockedSlugs]);

  useEffect(() => {
    if (!session) return;
    setElapsedMs(Date.now() - session.startedAt);
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - session.startedAt);
    }, 1000);
    return () => window.clearInterval(id);
  }, [session]);

  const endSession = useCallback(() => {
    finalizeSession();
    router.push(SESSION_START_PATH);
  }, [router]);

  const signOut = useCallback(() => {
    logLogout();
    clearActiveSession();
    clearSessionCookies();
    router.push(LOGIN_PATH);
    router.refresh();
  }, [router]);

  const scrollCards = useCallback((dir: 1 | -1) => {
    cardsRef.current?.scrollBy({ left: dir * 300, behavior: "smooth" });
  }, []);

  /** Meeting notes, logged as their own "notes" activity event so the
   * admin/manager timeline shows exactly what a sales staff member wrote
   * down about the customer, alongside what was shown and when. */
  const addNote = useCallback(() => {
    const text = noteText.trim();
    if (!text) return;
    logSessionEvent(text, "notes");
    setNoteText("");
    setNoteSaved(true);
    window.setTimeout(() => setNoteSaved(false), 1500);
  }, [noteText]);

  /** Explicit Busy/Available toggle, logged as its own "status" activity
   * event — the only in-app signal a "Busy" state (vs. the inferred
   * Online/In Meeting/Offline) can honestly come from, since nothing else
   * in this app generates that distinction on its own. */
  const toggleBusy = useCallback(() => {
    const next = !busy;
    setBusy(next);
    logSessionEvent(next ? "Marked Busy" : "Marked Available", "status");
  }, [busy]);

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
          {!isAdmin && session && (
            <button
              type="button"
              className={`${styles.busyToggle} ${busy ? styles.busyToggleActive : ""}`}
              onClick={toggleBusy}
            >
              {busy ? "Busy" : "Available"}
            </button>
          )}
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

      {!isAdmin && session && (
        <div className={styles.notesBar}>
          <input
            type="text"
            className={styles.notesInput}
            placeholder="Add a meeting note…"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addNote()}
          />
          <button type="button" className={styles.notesBtn} onClick={addNote}>
            {noteSaved ? "Saved" : "Add Note"}
          </button>
        </div>
      )}

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
                onClick={() =>
                  logSessionEvent(`Opened ${property.name || property.slug}`, "project_open")
                }
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

      {/* A second row of "Details" triggers, kept outside the anchor cards
          above (an <a> can't nest a <button>) so opening floor plan/gallery/
          amenities/brochure doesn't also navigate off-site. */}
      <div className={styles.detailsDock}>
        {properties
          .filter((property) => !blockedSlugs.includes(property.slug))
          .map((property) => (
            <button
              key={property.slug}
              type="button"
              className={styles.detailsBtn}
              onClick={() => setDetailsProperty(property)}
            >
              {property.name} Details
            </button>
          ))}
      </div>

      {detailsProperty && (
        <PropertyDetailsModal
          property={detailsProperty}
          onClose={() => setDetailsProperty(null)}
        />
      )}
    </div>
  );
}

const DETAIL_TABS = ["floor_plan", "gallery", "amenities", "brochure_download"] as const;
type DetailTab = (typeof DETAIL_TABS)[number];
const DETAIL_TAB_LABEL: Record<DetailTab, string> = {
  floor_plan: "Floor Plan",
  gallery: "Gallery",
  amenities: "Amenities",
  brochure_download: "Brochure",
};

/** Floor plan / gallery / amenities / brochure viewer for one project. Each
 * tab switch logs its own activity event (so the admin/manager timeline
 * shows exactly which content was shown, not just that the card was
 * opened), and the brochure tab triggers a real file download rather than
 * just claiming one happened. */
function PropertyDetailsModal({ property, onClose }: { property: Property; onClose: () => void }) {
  const [tab, setTab] = useState<DetailTab>("floor_plan");

  useEffect(() => {
    logSessionEvent(`Viewed ${DETAIL_TAB_LABEL[tab]} · ${property.name}`, tab);
  }, [tab, property.name]);

  const downloadBrochure = useCallback(() => {
    const lines = [
      `${property.name}`,
      property.location,
      property.href,
      "",
      "Amenities:",
      ...(property.amenities ?? []).map((a) => `- ${a}`),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${property.slug}-brochure.txt`;
    a.click();
    URL.revokeObjectURL(url);
    logSessionEvent(`Downloaded Brochure · ${property.name}`, "brochure_download");
  }, [property]);

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>{property.name}</h3>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>
        <div className={styles.modalTabs}>
          {DETAIL_TABS.map((t) => (
            <button
              key={t}
              type="button"
              className={`${styles.modalTab} ${tab === t ? styles.modalTabActive : ""}`}
              onClick={() => setTab(t)}
            >
              {DETAIL_TAB_LABEL[t]}
            </button>
          ))}
        </div>
        <div className={styles.modalBody}>
          {tab === "floor_plan" && (
            <div className={styles.modalMedia}>
              <ImageSlot placeholder={`Floor plan for ${property.name} (not yet supplied)`} />
            </div>
          )}
          {tab === "gallery" && (
            <div className={styles.modalMedia}>
              <ImageSlot
                src={property.image}
                placeholder={`${property.name} gallery image`}
                alt={property.name}
              />
            </div>
          )}
          {tab === "amenities" && (
            <ul className={styles.amenitiesList}>
              {(property.amenities ?? []).length === 0 ? (
                <li>No amenities listed yet.</li>
              ) : (
                property.amenities!.map((a) => <li key={a}>{a}</li>)
              )}
            </ul>
          )}
          {tab === "brochure_download" && (
            <div className={styles.modalMedia}>
              <p className={styles.brochureBlurb}>
                Download a plain-text spec sheet with this project&apos;s name, location, link and
                amenities.
              </p>
              <button type="button" className={styles.notesBtn} onClick={downloadBrochure}>
                Download Brochure
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
