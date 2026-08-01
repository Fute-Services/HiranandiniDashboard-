"use client";

import { useEffect, useState } from "react";
import { portfolioGroups, type PortfolioGroup, type Property } from "@/data/properties";
import { getSession } from "@/lib/auth";
import { getBlockedProjectsFor } from "@/lib/controls";
import { BackButton } from "./BackButton";
import { ImageSlot } from "./ImageSlot";
import { ShowroomCarousel } from "./ShowroomCarousel";
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
  /** Which card the carousel currently has facing front — it owns the
   * rotation, this only mirrors it so the header counter can track it. */
  const [featuredIndex, setFeaturedIndex] = useState(0);

  /** An admin/manager can block a project out of this staff member's
   * showcase (SessionReports's Sales Staff panel, /api/controls) — this
   * screen sits before PropertyShowcase in the staff flow, so it has to
   * enforce the same block or a blocked project is still fully reachable
   * from here. Same poll pattern as PropertyShowcase. */
  const [blockedSlugs, setBlockedSlugs] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    // The first poll always runs, even in a background tab, so a screen that
    // mounts in the background still knows what's blocked. Repeats keep the
    // hidden-tab skip.
    const poll = async (force = false) => {
      if (!force && document.hidden) return;
      const email = getSession()?.email;
      const slugs = email ? await getBlockedProjectsFor(email) : [];
      if (!cancelled) setBlockedSlugs(slugs);
    };
    poll(true);
    // 2s, not the usual 8s background poll: a block landing while a staff
    // member is mid-session needs to shut the project down right away, not
    // after a several-second lag.
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

  // Back to project 0 whenever a different portfolio is opened.
  useEffect(() => {
    setFeaturedIndex(0);
  }, [group]);

  const closePanel = () => setOpenProperty(null);

  const openProject = (property: Property) => setOpenProperty(property);

  // Blocked projects are filtered out here entirely — same as
  // PropertyShowcase's carousel — rather than shown disabled, so a blocked
  // project is simply not offered as an option.
  const visibleProjects = group?.projects.filter((p) => !blockedSlugs.includes(p.slug)) ?? [];
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
                    // it, so the showroom screen would just be a detour, and
                    // a "01/01 · only project in this portfolio" page is a
                    // dead end nobody asked for.
                    //
                    // This deliberately doesn't wait on the blocked-projects
                    // poll. Waiting is what made the shortcut miss and drop
                    // into the showroom instead, and there's nothing to gain:
                    // if the project does turn out blocked, the effect above
                    // shuts the panel the moment the poll says so and
                    // explains why — the same handling a block landing
                    // mid-session already gets.
                    const only = g.projects.length === 1 ? g.projects[0] : null;
                    if (!only) {
                      setGroup(g);
                    } else if (blockedSlugs.includes(only.slug)) {
                      // Already known blocked: say so rather than opening it
                      // just to close it again a moment later.
                      setBlockedNotice(true);
                    } else {
                      openProject(only);
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
      {group && count === 0 && (
        <div className={styles.lightPage}>
          <button type="button" className={styles.lightBack} onClick={() => setGroup(null)}>
            &#8592; Portfolios
          </button>
          <p className={styles.lightSubtitle}>
            No projects available to show from {group.name} right now.
          </p>
        </div>
      )}

      {/* Level 2: the "showroom" moment once a portfolio's been chosen — the
          projects ride a draggable horizontal coverflow arc (the same one the
          Property Index screen uses), on this screen's own dark backdrop
          rather than that screen's cream one. */}
      {group && count > 0 && (
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
            {/* Keyed on the portfolio so switching portfolios starts the arc
                back at its first card rather than wherever the last one had
                been spun to. */}
            <ShowroomCarousel
              key={group.slug}
              projects={visibleProjects}
              onOpen={openProject}
              onIndexChange={setFeaturedIndex}
            />
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
