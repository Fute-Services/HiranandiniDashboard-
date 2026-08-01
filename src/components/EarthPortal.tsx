"use client";

import { useEffect, useRef, useState } from "react";
import { portfolioGroups, type PortfolioGroup, type Property } from "@/data/properties";
import { getSession } from "@/lib/auth";
import { getBlockedProjectsFor } from "@/lib/controls";
import { BackButton } from "./BackButton";
import { ImageSlot } from "./ImageSlot";
import styles from "./EarthPortal.module.css";

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * The screen between a successful login and the property tour: pick a
 * portfolio (Alibaug, Fortune City, ...) first, then a project within it.
 * Picking a project opens that project's own site in an in-page panel.
 */
export function EarthPortal() {
  const [group, setGroup] = useState<PortfolioGroup | null>(null);
  const [openProperty, setOpenProperty] = useState<Property | null>(null);
  const [featuredIndex, setFeaturedIndex] = useState(0);
  const [featuredFading, setFeaturedFading] = useState(false);
  const fadeTimeoutRef = useRef<number | undefined>(undefined);

  /** An admin/manager can block a project out of this staff member's
   * showcase (SessionReports's Sales Staff panel, /api/controls) — this
   * screen sits before PropertyShowcase in the staff flow, so it has to
   * enforce the same block or a blocked project is still fully reachable
   * from here. Same poll pattern as PropertyShowcase. */
  const [blockedSlugs, setBlockedSlugs] = useState<string[]>([]);
  // Starts false so the single-project-portfolio auto-open shortcut below
  // can't fire on the very first render, before the initial poll has come
  // back — otherwise a blocked project briefly still looks unblocked
  // (default empty array) and opens anyway. It only gates that shortcut: the
  // portfolio grid renders straight away rather than waiting on the poll.
  const [blockedLoaded, setBlockedLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (document.hidden) return;
      const email = getSession()?.email;
      const slugs = email ? await getBlockedProjectsFor(email) : [];
      if (!cancelled) {
        setBlockedSlugs(slugs);
        setBlockedLoaded(true);
      }
    };
    poll();
    // 2s, not the usual 8s background poll: a block landing while a staff
    // member is mid-session needs to shut the project down right away, not
    // after a several-second lag.
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

  const [blockedNotice, setBlockedNotice] = useState(false);
  useEffect(() => {
    if (!blockedNotice) return;
    const id = window.setTimeout(() => setBlockedNotice(false), 4000);
    return () => window.clearTimeout(id);
  }, [blockedNotice]);

  // A block landing while the blocked project's panel is already open
  // wouldn't otherwise do anything — close it immediately, same as
  // PropertyShowcase does for its details modal, and say why instead of
  // just silently vanishing.
  useEffect(() => {
    setOpenProperty((current) => {
      if (current && blockedSlugs.includes(current.slug)) {
        setBlockedNotice(true);
        return null;
      }
      return current;
    });
  }, [blockedSlugs]);

  // Crossfades the featured slot instead of hard-cutting to the new card:
  // fade out, swap which project is shown, fade back in. Clears any fade
  // already in flight first — otherwise two picks close together race, and
  // whichever timeout resolves first silently drops the other's fade-out.
  const FEATURED_FADE_MS = 300;
  const selectFeatured = (next: (current: number) => number) => {
    window.clearTimeout(fadeTimeoutRef.current);
    setFeaturedFading(true);
    fadeTimeoutRef.current = window.setTimeout(() => {
      setFeaturedIndex(next);
      setFeaturedFading(false);
    }, FEATURED_FADE_MS);
  };

  // Back to project 0 whenever a different portfolio is opened.
  useEffect(() => {
    setFeaturedIndex(0);
    setFeaturedFading(false);
    return () => window.clearTimeout(fadeTimeoutRef.current);
  }, [group]);

  const closePanel = () => setOpenProperty(null);

  const openProject = (property: Property) => setOpenProperty(property);

  // Blocked projects are filtered out here entirely — same as
  // PropertyShowcase's carousel — rather than shown disabled, so a blocked
  // project is simply not offered as an option.
  const visibleProjects = group?.projects.filter((p) => !blockedSlugs.includes(p.slug)) ?? [];
  const featured = visibleProjects[featuredIndex] ?? null;
  const count = visibleProjects.length;

  return (
    <div className={styles.page}>
      {blockedNotice && (
        <div className={styles.blockedNotice} role="alert">
          This project is blocked. Contact your admin.
        </div>
      )}

      {!group && !openProperty && <BackButton />}

      {!group && (
        <div className={styles.welcome}>
          <div>
            <div className={styles.eyebrow}>Hiranandani Portfolio</div>
            <div className={styles.groupGrid}>
              {portfolioGroups.map((g) => (
                <button
                  key={g.slug}
                  type="button"
                  className={styles.groupCard}
                  onClick={() => {
                    // A single-project portfolio's card opens that project
                    // directly — there's nothing to browse once you're past
                    // it, so the showroom screen would just be a detour.
                    // Skipped if that one project is blocked, though — fall
                    // through to the group view instead of opening it anyway.
                    if (g.projects.length === 1 && blockedLoaded && !blockedSlugs.includes(g.projects[0].slug)) {
                      openProject(g.projects[0]);
                    } else {
                      setGroup(g);
                    }
                  }}
                >
                  <div className={styles.projectMedia}>
                    <ImageSlot src={g.projects[0]?.image} placeholder={`${g.name} image`} alt={g.name} instant />
                  </div>
                  <div className={styles.projectBody}>
                    <div className={styles.projectName}>{g.name}</div>
                    <div className={styles.projectLocation}>
                      {g.location} &middot; {g.projects.length} project
                      {g.projects.length === 1 ? "" : "s"}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Every project in this portfolio is blocked for this staff member —
          rare (blocking one is the normal case), but worth a real message
          instead of silently rendering nothing. */}
      {group && !featured && (
        <div className={styles.lightPage}>
          <button type="button" className={styles.lightBack} onClick={() => setGroup(null)}>
            &#8592; Portfolios
          </button>
          <p className={styles.lightSubtitle}>
            No projects available to show from {group.name} right now.
          </p>
        </div>
      )}

      {/* Level 2, light-themed: a single featured project card with
          arrow/list navigation, rather than the dark portfolio picker's
          grid — this is the "showroom" moment once a portfolio's been
          chosen, so it gets its own brighter, catalogue-like treatment. */}
      {group && featured && (
        <div className={styles.lightPage}>
          <button type="button" className={styles.lightBack} onClick={() => setGroup(null)}>
            &#8592; Portfolios
          </button>

          <header className={styles.lightHeader}>
            <div>
              <div className={styles.lightBrandRow}>
                <span className={styles.lightDiamond} />
                <span className={styles.lightBrand}>Hiranandani</span>
              </div>
              <h1 className={styles.lightTitle}>{group.name}</h1>
              <div className={styles.lightSubtitle}>
                {group.location} &middot; {count} project{count === 1 ? "" : "s"}
              </div>
            </div>
            <div className={styles.lightCounter}>
              <div className={styles.lightCounterNum}>
                {pad2(featuredIndex + 1)}
                <span className={styles.lightCounterSlash}>/</span>
                <span className={styles.lightCounterTotal}>{pad2(count)}</span>
              </div>
              <div className={styles.lightCounterCaption}>{group.name} Portfolio &middot; 2026</div>
            </div>
          </header>

          <div className={styles.lightBody}>
            <a
              className={`${styles.lightCard} ${featuredFading ? styles.lightCardFading : ""}`}
              href={featured.href}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                e.preventDefault();
                openProject(featured);
              }}
            >
              <div className={styles.lightCardMedia}>
                <ImageSlot
                  src={featured.image}
                  placeholder={`${featured.name} image`}
                  alt={`${featured.name}, ${featured.location}`}
                  fit="contain"
                  instant
                />
              </div>
              <div className={styles.lightCardFoot}>
                <span className={styles.lightCardIndex}>{pad2(featuredIndex + 1)}</span>
                <span className={styles.lightCardName}>{featured.name}</span>
                <span className={styles.lightVisit}>Visit&nbsp;&#8599;</span>
              </div>
            </a>

            <div className={styles.lightGrid}>
              {visibleProjects.map((p, i) => (
                <button
                  key={p.slug}
                  type="button"
                  className={`${styles.lightGridItem} ${i === featuredIndex ? styles.lightGridItemActive : ""}`}
                  onClick={() => selectFeatured(() => i)}
                >
                  <div className={styles.lightGridMedia}>
                    <ImageSlot src={p.image} placeholder={p.name} alt={p.name} instant />
                  </div>
                  <div className={styles.lightGridFoot}>
                    <span className={styles.lightGridIndex}>{pad2(i + 1)}</span>
                    <span className={styles.lightGridName}>{p.name}</span>
                  </div>
                </button>
              ))}
            </div>

            <div className={styles.lightNav}>
              <button
                type="button"
                className={styles.lightNavBtn}
                onClick={() => selectFeatured((i) => (i - 1 + count) % count)}
                disabled={count < 2}
                aria-label="Previous project"
              >
                &#8592;
              </button>
              <button
                type="button"
                className={styles.lightNavBtn}
                onClick={() => selectFeatured((i) => (i + 1) % count)}
                disabled={count < 2}
                aria-label="Next project"
              >
                &#8594;
              </button>
              <span className={styles.lightHint}>
                {count > 1 ? <>Use arrows &middot; or pick above</> : "Only project in this portfolio"}
              </span>
            </div>
          </div>
        </div>
      )}

      {openProperty && (
        <div className={styles.panelOverlay} onClick={closePanel}>
          <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
            <div className={styles.panelHeader}>
              <span>{openProperty.name}</span>
              <button
                type="button"
                className={styles.panelClose}
                onClick={closePanel}
                aria-label="Close"
              >
                &#10005;
              </button>
            </div>
            <div className={styles.panelBody}>
              {openProperty.href === "#" ? (
                <div className={styles.panelEmpty}>Site coming soon.</div>
              ) : (
                <iframe
                  className={styles.panelFrame}
                  src={openProperty.href}
                  title={openProperty.name}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
