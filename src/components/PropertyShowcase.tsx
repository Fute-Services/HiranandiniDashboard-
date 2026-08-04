"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Property } from "@/data/properties";
import { getSession, SESSION_START_PATH } from "@/lib/auth";
import { getBlockedProjectsFor } from "@/lib/controls";
import { getInventory } from "@/lib/inventory";
import {
  finalizeSession,
  getActiveSession,
  logSessionEvent,
  recordStepEnter,
  type ActiveSession,
} from "@/lib/session";
import { signOut } from "@/lib/sign-out";
import { useNavigationLock } from "@/lib/useNavigationLock";
import { ImageSlot } from "./ImageSlot";
import { Spinner } from "./Spinner";
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
  /** Manually admin-entered, real unit-availability counts (see
   * lib/inventory.ts) — a project absent here just shows no urgency note,
   * never a fabricated one. Polled alongside blockedSlugs below so a change
   * an admin makes mid-session (e.g. "down to 2 units") reaches the staff
   * member actually presenting, not just the next time they reload. */
  const [inventory, setInventory] = useState<Record<string, number | null>>({});
  const prevInventoryRef = useRef<Record<string, number | null> | null>(null);
  const [inventoryNotice, setInventoryNotice] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteSaved, setNoteSaved] = useState(false);
  const [detailsProperty, setDetailsProperty] = useState<Property | null>(null);
  /** "End Session" doesn't close out immediately — it gates on recording how
   * interested the customer seemed, so that signal exists for every session
   * instead of depending on staff remembering to type a free-text note. */
  const [showInterestGate, setShowInterestGate] = useState(false);
  const [busy, setBusy] = useState(false);
  /** The 360° panorama is a whole third-party site in an iframe and easily
   * the slowest thing on this screen — without a marker the customer just
   * stares at an empty black backdrop wondering if it's broken. */
  const [tourLoaded, setTourLoaded] = useState(false);
  /** An iframe's `load` is not guaranteed to ever fire: a site that stalls
   * mid-response leaves it pending indefinitely, and this one is a third
   * party we don't control. The overlay is opaque and covers the panorama,
   * so "never fires" used to mean a permanent "Loading 360° tour…" with a
   * dead screen behind it. Give up after a while and show whatever the frame
   * managed to render instead — the tour is the one thing on this screen
   * that's allowed to be half-there. Logged as its own event (distinct from a
   * normal successful load) so a staff member blaming "the system" for a
   * blank tour is verifiable against the activity log, not just their word. */
  useEffect(() => {
    if (tourLoaded) return;
    const id = window.setTimeout(() => {
      setTourLoaded(true);
      logSessionEvent("360° VR tour never finished loading (20s timeout)", "vr_load_failed");
    }, 20000);
    return () => window.clearTimeout(id);
  }, [tourLoaded]);
  /** False until the first blocked-projects poll answers. The shelf renders
   * a skeleton until then rather than showing every card and yanking the
   * blocked ones back out a moment later. */
  const [permissionsLoaded, setPermissionsLoaded] = useState(false);
  /** Which of the two leave-this-screen actions is under way (both navigate,
   * and sign-out also writes the logout event first). Self-releasing, so a
   * navigation that never lands can't leave End Session and Log out disabled
   * with a reload as the only way out (see lib/useNavigationLock). */
  const [leaving, setLeaving] = useNavigationLock<"end" | "logout">();

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
    // `force` is for the very first poll only. The hidden-tab skip exists to
    // stop background tabs polling, but it also used to skip the one poll
    // that flips `permissionsLoaded` — so a showcase that mounted while the
    // tab was in the background sat on "Loading projects…" with no Details
    // buttons at all until something brought the tab back. Repeats still
    // skip; the first one always runs.
    const poll = async (force = false) => {
      if (!force && document.hidden) return;
      const email = getSession()?.email;
      const [slugs, inv] = await Promise.all([
        email ? getBlockedProjectsFor(email) : Promise.resolve([]),
        getInventory(),
      ]);
      if (cancelled) return;
      setBlockedSlugs(slugs);
      setPermissionsLoaded(true);

      const prev = prevInventoryRef.current;
      if (prev) {
        const changedSlug = Object.keys(inv).find((slug) => inv[slug] !== prev[slug]);
        if (changedSlug) {
          const name = properties.find((p) => p.slug === changedSlug)?.name ?? changedSlug;
          const val = inv[changedSlug];
          setInventoryNotice(
            val === null || val === undefined
              ? `${name}: availability info cleared`
              : `${name}: ${val} unit${val === 1 ? "" : "s"} left`,
          );
        }
      }
      prevInventoryRef.current = inv;
      setInventory(inv);
    };
    poll(true);
    // 2s, not the usual 8s background poll: a block landing mid-session
    // needs to shut the project down right away, not after a lag.
    // Wrapped rather than passed directly: as a listener, `poll` would
    // receive the event as its `force` argument, and every focus would
    // count as forced.
    const tick = () => void poll();
    const id = window.setInterval(tick, 2000);
    const onVisible = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", tick);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", tick);
    };
    // `properties` is this component's own prop, fixed for its whole mount
    // (static per-portfolio data, not state) — safe to read inside the poll
    // without retriggering the effect on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [blockedNotice, setBlockedNotice] = useState(false);
  useEffect(() => {
    if (!blockedNotice) return;
    const id = window.setTimeout(() => setBlockedNotice(false), 4000);
    return () => window.clearTimeout(id);
  }, [blockedNotice]);

  useEffect(() => {
    if (!inventoryNotice) return;
    const id = window.setTimeout(() => setInventoryNotice(null), 4000);
    return () => window.clearTimeout(id);
  }, [inventoryNotice]);

  // A block that lands while that exact project's details modal is already
  // open wouldn't otherwise do anything — blockedSlugs only filters the
  // card/button lists a staff member picks from, not a modal already
  // rendered from a click made before the block. Force it shut the moment
  // its slug shows up blocked, so mid-session blocking is actually
  // immediate, not just "can't open it again" — and say why instead of
  // letting the modal just vanish.
  useEffect(() => {
    setDetailsProperty((current) => {
      if (current && blockedSlugs.includes(current.slug)) {
        setBlockedNotice(true);
        return null;
      }
      return current;
    });
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
    setShowInterestGate(true);
  }, []);

  const confirmEndSession = useCallback(
    (interest: "Highly Interested" | "Neutral" | "Not Interested" | "Follow-up Later") => {
      logSessionEvent(interest, "interest_level");
      setShowInterestGate(false);
      setLeaving("end");
      finalizeSession();
      router.push(SESSION_START_PATH);
    },
    [router],
  );

  const leave = useCallback(() => {
    setLeaving("logout");
    void signOut();
  }, []);

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
      {blockedNotice && (
        <div className={styles.blockedNotice} role="alert">
          This project is blocked. Contact your admin.
        </div>
      )}
      {inventoryNotice && (
        <div className={styles.inventoryNotice} role="status">
          {inventoryNotice}
        </div>
      )}
      <div className={styles.vrBackdrop}>
        <iframe
          className={styles.vrFrame}
          src={VR_TOUR_URL}
          title="360° property tour"
          allow="gyroscope; accelerometer; xr-spatial-tracking"
          onLoad={() => setTourLoaded(true)}
          // A frame that fails outright shouldn't keep claiming it's loading.
          onError={() => {
            setTourLoaded(true);
            logSessionEvent("360° VR tour failed to load (error)", "vr_load_failed");
          }}
        />
        {!tourLoaded && (
          <div className={styles.vrLoading} role="status">
            <Spinner size={26} />
            <span className={styles.vrLoadingLabel}>Loading 360&deg; tour…</span>
          </div>
        )}
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
            <button
              type="button"
              className={styles.endSession}
              onClick={endSession}
              disabled={leaving !== null}
              aria-busy={leaving === "end"}
            >
              {leaving === "end" ? (
                <>
                  <Spinner size={12} />
                  Ending…
                </>
              ) : (
                "End Session"
              )}
            </button>
          )}
          <button
            type="button"
            className={styles.signout}
            onClick={leave}
            disabled={leaving !== null}
            aria-busy={leaving === "logout"}
          >
            {leaving === "logout" ? (
              <>
                <Spinner size={12} />
                Signing out…
              </>
            ) : (
              "Log out"
            )}
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
          <div className={styles.shelfLabel}>Fute Services Portfolio &middot; 2026</div>
          <div className={styles.cards} ref={cardsRef}>
            {/* No loading placeholder here on purpose: these cards are
                choreographed to fly in several seconds after mount anyway
                (see .card's animation-delay), which is long past when the
                blocked-projects poll answers — a skeleton would only ever
                flash before the reveal it's meant to stand in for. */}
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
                  {typeof inventory[property.slug] === "number" && (
                    <span className={styles.unitsLeftBadge}>
                      Only {inventory[property.slug]} unit{inventory[property.slug] === 1 ? "" : "s"} left
                    </span>
                  )}
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
        {!permissionsLoaded && (
          <span className={styles.detailsLoading} role="status">
            <Spinner size={12} />
            Loading projects…
          </span>
        )}
        {permissionsLoaded &&
          properties
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

      {showInterestGate && (
        <div className={styles.modalBackdrop} onClick={() => setShowInterestGate(false)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3 className={styles.modalTitle}>How interested did the customer seem?</h3>
              <button
                type="button"
                className={styles.modalClose}
                onClick={() => setShowInterestGate(false)}
                aria-label="Close"
              >
                &times;
              </button>
            </div>
            <div className={styles.interestOptions}>
              {(["Highly Interested", "Neutral", "Not Interested", "Follow-up Later"] as const).map((level) => (
                <button
                  key={level}
                  type="button"
                  className={styles.interestOption}
                  onClick={() => confirmEndSession(level)}
                >
                  {level}
                </button>
              ))}
            </div>
          </div>
        </div>
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
  /** The file itself is built locally and lands instantly, so this is a
   * confirmation rather than a spinner — a browser download that opens no
   * window otherwise gives no sign the click registered at all. */
  const [downloaded, setDownloaded] = useState(false);

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
    setDownloaded(true);
    window.setTimeout(() => setDownloaded(false), 2000);
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
                {downloaded ? "Downloaded ✓" : "Download Brochure"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
