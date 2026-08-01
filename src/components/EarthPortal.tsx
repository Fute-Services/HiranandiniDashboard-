"use client";

import { useEffect, useState } from "react";
import { portfolioGroups, type PortfolioGroup, type Property } from "@/data/properties";
import { getSession } from "@/lib/auth";
import { getBlockedProjectsFor } from "@/lib/controls";
import { BackButton } from "./BackButton";
import { ImageSlot } from "./ImageSlot";
import { Showcase } from "./Showcase";
import styles from "./EarthPortal.module.css";

/**
 * The screen between a successful login and the property tour: pick a
 * portfolio (Alibaug, Fortune City, ...) first, then a project within it.
 *
 * Two levels, two components. This one owns the portfolio picker, the
 * blocked-projects poll that both levels answer to, and the in-page panel a
 * single-project portfolio opens straight into. Picking a multi-project
 * portfolio hands off to `Showcase`, which owns the showroom screen itself.
 */
export function EarthPortal() {
  const [group, setGroup] = useState<PortfolioGroup | null>(null);
  const [openProperty, setOpenProperty] = useState<Property | null>(null);

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

  const closePanel = () => setOpenProperty(null);

  const openProject = (property: Property) => setOpenProperty(property);

  // Blocked projects are filtered out here entirely — same as
  // PropertyShowcase's carousel — rather than shown disabled, so a blocked
  // project is simply not offered as an option. Doing it here means the
  // showroom below only ever receives projects it's allowed to show, and
  // its counter ("02/06") counts the same set the staff member can reach.
  const visibleProjects = group?.projects.filter((p) => !blockedSlugs.includes(p.slug)) ?? [];

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
      {group && visibleProjects.length === 0 && (
        <div className={styles.emptyPage}>
          <button type="button" className={styles.emptyBack} onClick={() => setGroup(null)}>
            &#8592; Portfolios
          </button>
          <p className={styles.emptyMessage}>
            No projects available to show from {group.name} right now.
          </p>
        </div>
      )}

      {/* Level 2: the showroom moment once a portfolio's been chosen. Its
          own component, built to the design system — one screen that never
          scrolls, hero card over a thumbnail rail over prev/next. Blocked
          projects are filtered out before it ever sees them, so it doesn't
          need to know about blocking at all. */}
      {group && visibleProjects.length > 0 && (
        <div className={styles.showroomLayer}>
          <Showcase
            showcase={{
              brand: "Hiranandani",
              title: group.name,
              subtitle: group.location,
              year: "2026",
              items: visibleProjects.map((p) => ({
                id: p.slug,
                name: p.name,
                image: p.image ?? "",
                href: p.href,
              })),
            }}
            onBack={() => setGroup(null)}
          />
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
