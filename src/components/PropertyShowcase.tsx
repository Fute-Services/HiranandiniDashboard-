"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { projectsIn, type Property } from "@/data/properties";
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
 * The one screen a presentation runs on: the 360° VR tour plays fully sharp
 * behind everything, since the panorama is the visual lead, and every project
 * sits in a shelf along the bottom. Tapping a project opens its own site
 * full-screen in this tab (see `ProjectViewer`); × brings the showcase back.
 *
 * Log out is the only way off the screen — there is no separate End Session
 * step, so one login is one customer, and signing out is what closes the
 * presentation out in the activity log (see `leave`).
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
  /** The meeting-note field is off by default and opened from the header —
   * see the notes bar below for why it isn't just always on screen. */
  const [notesOpen, setNotesOpen] = useState(false);
  const [detailsProperty, setDetailsProperty] = useState<Property | null>(null);
  /** The project whose own site is open, full-screen, over the showcase.
   * Null means the shelf/VR tour is what's on screen. */
  const [viewerProperty, setViewerProperty] = useState<Property | null>(null);
  /** Mirrors `viewerProperty` plus the moment it opened. A ref, not state,
   * because `closeViewer` has to log the project it's closing *and* how long
   * it was up — and reading that out of a `setState` updater would put a log
   * write inside a function React is free to call twice. */
  const viewerRef = useRef<{ property: Property; openedAt: number; within?: string } | null>(null);

  /** `within` names the portfolio a project was opened from, when it wasn't
   * opened off the shelf directly — a tower reached through Fortune City's
   * details panel logs as "Ebony · Fortune City", so the timeline says where
   * in the presentation it was reached from, not just that it was shown. */
  const openViewer = useCallback((property: Property, within?: string) => {
    viewerRef.current = { property, openedAt: Date.now(), within };
    setViewerProperty(property);
    const name = property.name || property.slug;
    logSessionEvent(within ? `Opened ${name} · ${within}` : `Opened ${name}`, "project_open");
  }, []);

  /** Every way out of the viewer goes through here — the × button, Escape, a
   * mid-session block, Log out — so the close event and its
   * measured duration land exactly once however it closed. Clearing the ref
   * first makes a second call a no-op rather than a duplicate log line. */
  const closeViewer = useCallback((reason?: string) => {
    const open = viewerRef.current;
    viewerRef.current = null;
    setViewerProperty(null);
    if (!open) return;
    const base = open.property.name || open.property.slug;
    const name = open.within ? `${base} · ${open.within}` : base;
    logSessionEvent(
      reason ? `Closed ${name} · ${reason}` : `Closed ${name}`,
      "project_close",
      Date.now() - open.openedAt,
    );
  }, []);
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
  /** Set while signing out, to stop a second click firing a second logout.
   * Self-releasing, so a navigation that never lands can't leave Log out
   * disabled with a reload as the only way out (see lib/useNavigationLock). */
  const [leaving, setLeaving] = useNavigationLock<"logout">();

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
  // The full-screen project viewer is shut the same way and for the same
  // reason: a block that only hid the card would leave the blocked project's
  // own site still filling the screen in front of the customer.
  useEffect(() => {
    setDetailsProperty((current) => {
      if (current && blockedSlugs.includes(current.slug)) {
        setBlockedNotice(true);
        return null;
      }
      return current;
    });
    const open = viewerRef.current;
    if (open && blockedSlugs.includes(open.property.slug)) {
      setBlockedNotice(true);
      closeViewer("blocked by admin");
    }
  }, [blockedSlugs, closeViewer]);

  useEffect(() => {
    if (!session) return;
    setElapsedMs(Date.now() - session.startedAt);
    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - session.startedAt);
    }, 1000);
    return () => window.clearInterval(id);
  }, [session]);

  /** Log out is the only way off this screen now — there is no End Session
   * step — so the presentation has to be closed out properly here rather
   * than just abandoned. Order matters: both log writes are attributed to
   * the active session, so they have to happen before finalizeSession()
   * clears it, or they silently no-op and that project's dwell time and the
   * presentation's final step duration are both lost. */
  const leave = useCallback(() => {
    closeViewer("logged out");
    finalizeSession();
    setLeaving("logout");
    void signOut();
  }, [closeViewer]);

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
              className={styles.notesToggle}
              onClick={() => setNotesOpen((v) => !v)}
              aria-pressed={notesOpen}
            >
              Note
            </button>
          )}
          {!isAdmin && session && (
            <button
              type="button"
              className={`${styles.busyToggle} ${busy ? styles.busyToggleActive : ""}`}
              onClick={toggleBusy}
            >
              {busy ? "Busy" : "Available"}
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

      {/* Opened from the header rather than parked permanently under it: this
          screen is pointed at a customer, and a staff-only scratchpad sitting
          open across the top the whole time is one more thing they can read
          and one more thing on screen. */}
      {!isAdmin && session && notesOpen && (
        <div className={styles.notesBar}>
          <input
            type="text"
            className={styles.notesInput}
            placeholder="Add a meeting note…"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addNote()}
            autoFocus
          />
          <button type="button" className={styles.notesBtn} onClick={addNote}>
            {noteSaved ? "Saved" : "Add Note"}
          </button>
          <button
            type="button"
            className={styles.notesClose}
            onClick={() => setNotesOpen(false)}
            aria-label="Close notes"
          >
            &times;
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
            {!permissionsLoaded && (
              <span className={styles.cardsLoading} role="status">
                <Spinner size={12} />
                Loading projects…
              </span>
            )}
            {/* One row per project, not two. Each card used to be a bare link
                off-site, with a second full-width row of "<name> Details"
                buttons underneath repeating the same list — the same six
                projects named twice, which is most of what made this screen
                feel busy in front of a customer. The card is a plain element
                now (an <a> can't legally contain a <button>) and carries both
                actions itself. */}
            {permissionsLoaded &&
              properties
                .filter((property) => !blockedSlugs.includes(property.slug))
                .map((property, i) => (
                  <div key={property.slug} className={styles.card}>
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
                      <div className={styles.cardLocation}>{property.location}</div>
                      {typeof inventory[property.slug] === "number" && (
                        <span className={styles.unitsLeftBadge}>
                          Only {inventory[property.slug]} unit{inventory[property.slug] === 1 ? "" : "s"} left
                        </span>
                      )}
                      <div className={styles.cardActions}>
                        <button
                          type="button"
                          className={styles.cardDetailsBtn}
                          onClick={() => setDetailsProperty(property)}
                        >
                          Details
                        </button>
                        {/* Opens the project's site in this tab, over the
                            showcase — not `target="_blank"`. A new tab took the
                            staff member out of the app in front of the
                            customer, and the activity log lost them there: no
                            close, no dwell, every roadmap node stuck on
                            "Ongoing". */}
                        <button
                          type="button"
                          className={styles.cardLink}
                          onClick={() => openViewer(property)}
                        >
                          Open&nbsp;&#8599;
                        </button>
                      </div>
                    </div>
                  </div>
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

      {viewerProperty && (
        <ProjectViewer
          property={viewerProperty}
          onClose={() => closeViewer()}
          onDetails={() => {
            const property = viewerProperty;
            closeViewer("opened details");
            setDetailsProperty(property);
          }}
        />
      )}

      {detailsProperty && (
        <PropertyDetailsModal
          property={detailsProperty}
          onClose={() => setDetailsProperty(null)}
          onOpenProject={(project) => {
            const within = detailsProperty.name || detailsProperty.slug;
            setDetailsProperty(null);
            openViewer(project, within);
          }}
        />
      )}

    </div>
  );
}

/**
 * One project's own website, full-screen in this tab, over the showcase —
 * with a × to come back. The alternative was `target="_blank"`, which in a
 * showroom means the staff member is now driving a bare browser tab in front
 * of the customer: no session header, no timer, no Log out, and nothing
 * to click to get back but the browser's own chrome (which a kiosk may not
 * even show). It also ended the activity log at "Opened X" — the close and
 * the dwell time both happened somewhere this app couldn't see.
 *
 * Opening and closing are logged by the parent, not here, so a React that
 * mounts effects twice can't double-log them.
 */
function ProjectViewer({
  property,
  onClose,
  onDetails,
}: {
  property: Property;
  onClose: () => void;
  onDetails: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  /** True once the frame has had long enough that "still blank" means it
   * isn't coming. None of these sites send X-Frame-Options or a
   * frame-ancestors CSP today, but they're third parties who can add one
   * without telling us — and the failure mode is a black rectangle in front
   * of a customer. The escape hatch below is the honest answer to that. */
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    if (loaded) return;
    const id = window.setTimeout(() => setStalled(true), 12000);
    return () => window.clearTimeout(id);
  }, [loaded]);

  // Escape closes, like every other overlay on this screen. Bound on the
  // document because focus is usually inside the iframe, where React's own
  // synthetic key events never reach.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className={styles.viewer} role="dialog" aria-label={`${property.name} website`}>
      <header className={styles.viewerBar}>
        <div className={styles.viewerTitleGroup}>
          <span className={styles.viewerName}>{property.name}</span>
          <span className={styles.viewerLocation}>{property.location}</span>
        </div>
        <div className={styles.viewerActions}>
          <button type="button" className={styles.cardDetailsBtn} onClick={onDetails}>
            Details
          </button>
          <button
            type="button"
            className={styles.viewerClose}
            onClick={onClose}
            aria-label={`Close ${property.name}`}
            title="Close (Esc)"
          >
            &times;
          </button>
        </div>
      </header>
      <div className={styles.viewerStage}>
        {/* The sandbox is permissive on purpose — these are real marketing
            sites that need their own scripts, storage, forms and popups to
            work at all. The one thing deliberately withheld is
            `allow-top-navigation`: a site that framebusts ("if I'm in a
            frame, escape it") would otherwise navigate the entire app away
            mid-presentation, taking the session, the timer and the activity
            log with it. */}
        <iframe
          className={styles.viewerFrame}
          src={property.href}
          title={`${property.name} website`}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-downloads"
          allow="gyroscope; accelerometer; xr-spatial-tracking; fullscreen"
          onLoad={() => setLoaded(true)}
          onError={() => setStalled(true)}
        />
        {!loaded && (
          <div className={styles.viewerLoading} role="status">
            <Spinner size={26} />
            <span className={styles.vrLoadingLabel}>
              {stalled ? `${property.name} is taking a while…` : `Loading ${property.name}…`}
            </span>
            {stalled && (
              <a
                className={styles.viewerFallback}
                href={property.href}
                target="_blank"
                rel="noreferrer"
              >
                Open in a new tab instead &#8599;
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const DETAIL_TABS = [
  "property_shown",
  "floor_plan",
  "gallery",
  "amenities",
  "brochure_download",
] as const;
type DetailTab = (typeof DETAIL_TABS)[number];
const DETAIL_TAB_LABEL: Record<DetailTab, string> = {
  property_shown: "Projects",
  floor_plan: "Floor Plan",
  gallery: "Gallery",
  amenities: "Amenities",
  brochure_download: "Brochure",
};

/** Projects / floor plan / gallery / amenities / brochure viewer for one
 * portfolio. Each tab switch logs its own activity event (so the
 * admin/manager timeline shows exactly which content was shown, not just that
 * the card was opened), and the brochure tab triggers a real file download
 * rather than just claiming one happened.
 *
 * The Projects tab is where Fortune City's six towers live now that the shelf
 * is one card per portfolio. Opening one from here goes through the same
 * in-app viewer as a shelf card, so it is recorded identically — with the
 * portfolio it was reached from attached to the event.
 */
function PropertyDetailsModal({
  property,
  onClose,
  onOpenProject,
}: {
  property: Property;
  onClose: () => void;
  onOpenProject: (project: Property) => void;
}) {
  const children = projectsIn(property.slug);
  /** A portfolio that is a single project (Alibaug) has no tower list, so its
   * Projects tab would be a permanently empty panel — drop it entirely and
   * open on Floor Plan instead. */
  const tabs = DETAIL_TABS.filter((t) => t !== "property_shown" || children.length > 0);
  const [tab, setTab] = useState<DetailTab>(tabs[0]);
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
          {tabs.map((t) => (
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
          {tab === "property_shown" && (
            <ul className={styles.projectList}>
              {children.map((child) => (
                <li key={child.slug} className={styles.projectRow}>
                  <div className={styles.projectThumb}>
                    <ImageSlot
                      src={child.image}
                      placeholder={child.name}
                      alt={`${child.name}, ${child.location}`}
                    />
                  </div>
                  <div className={styles.projectMeta}>
                    <span className={styles.projectName}>{child.name}</span>
                    <span className={styles.projectLocation}>{child.location}</span>
                  </div>
                  <button
                    type="button"
                    className={styles.cardLink}
                    onClick={() => onOpenProject(child)}
                  >
                    Open&nbsp;&#8599;
                  </button>
                </li>
              ))}
            </ul>
          )}
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
