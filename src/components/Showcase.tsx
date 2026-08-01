"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./Showcase.module.css";

/** §7 — data shape. */
export type ShowcaseItem = { id: string; name: string; image: string; href: string };

export type Showcase = {
  brand: string; // "HIRANANDANI"  → eyebrow
  title: string; // "Fortune City" → hero title
  subtitle: string; // "HIRANANDANI FORTUNE CITY"
  year: string; // "2026"
  items: ShowcaseItem[];
};

const pad2 = (n: number) => String(n).padStart(2, "0");

/** §5 — hero media crossfade. Matches --t-hover in the stylesheet. */
const CROSSFADE_MS = 300;

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Single-screen, non-scrolling project showcase: one hero card, a thumbnail
 * rail under it, prev/next below that. Nothing on the screen scrolls except
 * the rail, at any viewport the responsive rules cover.
 *
 * Self-contained by design — every colour, radius and spacing value comes
 * from the token block at the top of Showcase.module.css, so re-skinning is
 * an edit to that one block and nothing else.
 *
 * `onBack` is optional: the back pill renders only when there's somewhere to
 * go back to, rather than sitting there dead.
 */
export function Showcase({
  showcase,
  onBack,
}: {
  showcase: Showcase;
  onBack?: () => void;
}) {
  const { brand, title, subtitle, year, items } = showcase;
  const count = items.length;

  const [active, setActive] = useState(0);
  /** Which item the well is *showing*. Trails `active` by one crossfade so
   * the media can fade out and back in while the footer — index, name,
   * Visit link — swaps immediately, per §5. */
  const [mediaIndex, setMediaIndex] = useState(0);
  const [mediaFading, setMediaFading] = useState(false);
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const step = useCallback(
    (dir: 1 | -1) => {
      if (count < 2) return;
      setActive((i) => (i + dir + count) % count);
    },
    [count],
  );

  // Runs the crossfade off whatever `active` currently is, rather than off
  // the click that changed it: two picks in quick succession then resolve to
  // the latest one instead of racing, because the cleanup cancels the fade
  // still in flight.
  useEffect(() => {
    if (mediaIndex === active) return;
    if (prefersReducedMotion()) {
      setMediaIndex(active);
      return;
    }
    setMediaFading(true);
    const id = window.setTimeout(() => {
      setMediaIndex(active);
      setMediaFading(false);
    }, CROSSFADE_MS);
    return () => window.clearTimeout(id);
  }, [active, mediaIndex]);

  // §5 — arrow keys drive the same activeIndex the buttons do, except while
  // the user is typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) {
        return;
      }
      e.preventDefault();
      step(e.key === "ArrowRight" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  // Keep the active thumb reachable once the rail overflows.
  useEffect(() => {
    thumbRefs.current[active]?.scrollIntoView({
      block: "nearest",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [active]);

  if (count === 0) return null;

  const current = items[Math.min(active, count - 1)];
  const shown = items[Math.min(mediaIndex, count - 1)];

  return (
    <div className={styles.page}>
      {onBack && (
        <button type="button" className={styles.backPill} onClick={onBack}>
          <span className={styles.backArrow} aria-hidden="true">
            &#8592;
          </span>
          Portfolios
        </button>
      )}

      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>
            <span className={styles.diamond} aria-hidden="true" />
            {brand}
          </div>
          <h1 className={styles.title}>{title}</h1>
          <div className={styles.subLabel}>
            {subtitle} &middot; {count} project{count === 1 ? "" : "s"}
          </div>
        </div>

        <div className={styles.counter}>
          <div className={styles.counterNum} aria-live="polite">
            {pad2(active + 1)}
            <span className={styles.counterTotal}>/{pad2(count)}</span>
          </div>
          <div className={styles.counterCaption}>
            {title} Portfolio &middot; {year}
          </div>
        </div>
      </header>

      <div className={styles.stage}>
        <article className={styles.card}>
          <div className={styles.well}>
            {/* eslint-disable-next-line @next/next/no-img-element -- remote, arbitrary showcase URLs */}
            <img
              className={`${styles.wellImage} ${mediaFading ? styles.wellImageFading : ""}`}
              src={shown.image}
              alt={shown.name}
            />
          </div>
          <div className={styles.cardFoot}>
            <div className={styles.cardFootLeft}>
              <span className={styles.index}>{pad2(active + 1)}</span>
              <span className={styles.cardName}>{current.name}</span>
            </div>
            <a className={styles.visit} href={current.href} target="_blank" rel="noreferrer">
              Visit&nbsp;&#8599;
            </a>
          </div>
        </article>

        <div className={styles.rail}>
          {items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              ref={(el) => {
                thumbRefs.current[i] = el;
              }}
              className={`${styles.thumb} ${i === active ? styles.thumbActive : ""}`}
              aria-current={i === active ? "true" : undefined}
              onClick={() => setActive(i)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- remote, arbitrary showcase URLs */}
              <img className={styles.thumbImage} src={item.image} alt="" />
              <span className={styles.thumbCaption}>
                <span className={styles.index}>{pad2(i + 1)}</span>
                <span className={styles.thumbName}>{item.name}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.controls}>
        <div className={styles.navGroup}>
          <button
            type="button"
            className={styles.navBtn}
            onClick={() => step(-1)}
            aria-label="Previous project"
          >
            &#8592;
          </button>
          <button
            type="button"
            className={styles.navBtn}
            onClick={() => step(1)}
            aria-label="Next project"
          >
            &#8594;
          </button>
        </div>
        <span className={styles.hint}>Use arrows &middot; or pick above</span>
      </div>
    </div>
  );
}
