"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Property } from "@/data/properties";
import { AUTH_COOKIE, LOGIN_PATH } from "@/lib/auth";
import { ImageSlot } from "./ImageSlot";
import styles from "./PropertyCarousel.module.css";

/**
 * Coverflow arc rather than the design's closed prism ring. A ring only reads
 * well when neighbours sit within ~50° of the front (true at the design's seven
 * cards); at three they'd be 120° apart, past the backface cutoff, so only one
 * card would ever be visible. The arc keeps all three on screen at any count.
 */
const SPACING = 430; // px along X per card of offset
const DEPTH = 200; // px pushed back per card of offset
const TILT = 42; // deg turned away per card of offset
const DESIGN_WIDTH = 2 * SPACING + 440; // centre card + a neighbour either side
const AUTO_SPEED = 0.0031; // cards per frame, the design's drift rate
const RESUME_DELAY = 4000;
/**
 * px of travel before a press counts as a drag rather than a click. Generous
 * on purpose: a drag swallows the click, and a real hand wobbles several px
 * while clicking, so a tight threshold eats clicks on the cards' links.
 */
const DRAG_THRESHOLD = 12;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Signed distance from `position` to card `i`, wrapped so the arc loops. */
function wrapOffset(i: number, position: number, count: number) {
  const half = count / 2;
  return (((i - position + half) % count) + count) % count - half;
}

function faceTransform(offset: number) {
  return (
    `translateX(${(offset * SPACING).toFixed(1)}px) ` +
    `translateZ(${(-Math.abs(offset) * DEPTH).toFixed(1)}px) ` +
    `rotateY(${(-offset * TILT).toFixed(2)}deg)`
  );
}

export function PropertyCarousel({ properties }: { properties: Property[] }) {
  const count = properties.length;
  const router = useRouter();

  /** Clears the session cookie; the middleware then bounces us to the login. */
  const signOut = useCallback(() => {
    document.cookie = `${AUTH_COOKIE}=; path=/; max-age=0; samesite=lax`;
    router.push(LOGIN_PATH);
    router.refresh();
  }, [router]);

  const stageRef = useRef<HTMLDivElement>(null);
  const scalerRef = useRef<HTMLDivElement>(null);
  const prismRef = useRef<HTMLDivElement>(null);

  /** Which card is at the front, as a float; 1.5 means midway between 1 and 2. */
  const positionRef = useRef(0);
  const autoRef = useRef(true);
  const pressedRef = useRef(false);
  const draggingRef = useRef(false);
  /** Whether the press that just ended was a drag, so its click can be eaten. */
  const draggedRef = useRef(false);
  const dragStartRef = useRef({ x: 0, position: 0 });
  const resumeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [index, setIndex] = useState(0);

  /** Toggles the snap transition; off while free-spinning or dragging. */
  const setAnimated = useCallback((on: boolean) => {
    prismRef.current?.setAttribute("data-animated", String(on));
  }, []);

  /**
   * Lays the cards out along the arc for the current position: each is slid,
   * pushed back and turned away in proportion to its distance from the front,
   * then depth-cued (fade + blur). Only the front card is clickable.
   */
  const render3d = useCallback(() => {
    const prism = prismRef.current;
    if (!prism) return;

    const position = positionRef.current;
    const faces = Array.from(prism.children) as HTMLElement[];

    faces.forEach((face, i) => {
      const offset = wrapOffset(i, position, count);
      const distance = Math.abs(offset);

      face.style.transform = faceTransform(offset);
      face.style.pointerEvents = distance < 0.5 ? "auto" : "none";

      const card = face.firstElementChild as HTMLElement | null;
      if (card) {
        card.style.opacity = Math.max(0.08, 1 - distance * 0.5).toFixed(3);
        card.style.filter =
          distance > 0.4 ? `blur(${((distance - 0.4) * 3).toFixed(1)}px)` : "none";
      }
    });

    setIndex(((Math.round(position) % count) + count) % count);
  }, [count]);

  /** Auto-rotation resumes only after the user has been idle for a moment. */
  const pauseAuto = useCallback(() => {
    autoRef.current = false;
    if (resumeRef.current) clearTimeout(resumeRef.current);
    resumeRef.current = setTimeout(() => {
      autoRef.current = true;
      setAnimated(false);
    }, RESUME_DELAY);
  }, [setAnimated]);

  const snapTo = useCallback(
    (position: number) => {
      autoRef.current = false;
      setAnimated(true);
      positionRef.current = position;
      render3d();
      pauseAuto();
    },
    [pauseAuto, render3d, setAnimated],
  );

  /** `dir` is +1 for the next card, -1 for the previous one. */
  const nudge = useCallback(
    (dir: 1 | -1) => {
      snapTo(Math.round(positionRef.current) + dir);
    },
    [snapTo],
  );

  /** Travels the short way round to `target`. */
  const goTo = useCallback(
    (target: number) => {
      const settled = Math.round(positionRef.current);
      const current = ((settled % count) + count) % count;
      let diff = target - current;
      if (diff > count / 2) diff -= count;
      if (diff < -count / 2) diff += count;
      snapTo(settled + diff);
    },
    [count, snapTo],
  );

  // Scale the whole stage down on narrow viewports so the prism never crops.
  useEffect(() => {
    const fit = () => {
      const stage = stageRef.current;
      const scaler = scalerRef.current;
      if (!stage || !scaler) return;
      const available = Math.min(stage.clientWidth, window.innerWidth * 0.94);
      scaler.style.transform = `scale(${Math.min(1, available / DESIGN_WIDTH)})`;
    };

    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") nudge(1);
      else if (e.key === "ArrowLeft") nudge(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nudge]);

  useEffect(() => {
    setAnimated(false);
    render3d();

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduceMotion) {
      autoRef.current = false;
      return;
    }

    let raf = 0;
    const loop = () => {
      if (autoRef.current && !draggingRef.current) {
        positionRef.current += AUTO_SPEED;
        render3d();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(raf);
  }, [render3d, setAnimated]);

  useEffect(
    () => () => {
      if (resumeRef.current) clearTimeout(resumeRef.current);
    },
    [],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pressedRef.current = true;
    draggedRef.current = false;
    autoRef.current = false; // freeze the drift under the finger
    dragStartRef.current = { x: e.clientX, position: positionRef.current };
  };

  /** A press only becomes a drag once it has travelled past the threshold. */
  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!pressedRef.current) return;
      const dx = e.clientX - dragStartRef.current.x;

      if (!draggingRef.current) {
        if (Math.abs(dx) < DRAG_THRESHOLD) return;
        draggingRef.current = true;
        setAnimated(false);
        stageRef.current?.setAttribute("data-dragging", "true");
      }

      // Divide by SPACING so the front card tracks the pointer 1:1.
      positionRef.current = dragStartRef.current.position - dx / SPACING;
      render3d();
    },
    [render3d, setAnimated],
  );

  const endPress = useCallback(() => {
    if (!pressedRef.current) return;
    pressedRef.current = false;

    // A tap: let the click through to the card and let the drift resume.
    if (!draggingRef.current) {
      pauseAuto();
      return;
    }

    draggedRef.current = true; // swallow the click this drag is about to fire
    draggingRef.current = false;
    stageRef.current?.setAttribute("data-dragging", "false");
    snapTo(Math.round(positionRef.current));
  }, [pauseAuto, snapTo]);

  /**
   * The move and release are watched on the window so a drag that travels off
   * the stage keeps tracking and still settles. setPointerCapture would do the
   * same, but it retargets the click that follows to the stage, which is how
   * the cards' links were being swallowed.
   */
  useEffect(() => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endPress);
    window.addEventListener("pointercancel", endPress);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", endPress);
      window.removeEventListener("pointercancel", endPress);
    };
  }, [endPress, onPointerMove]);

  /** Keeps the click that ends a drag from opening the card it landed on. */
  const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!draggedRef.current) return;
    e.preventDefault();
    e.stopPropagation();
  };

  /**
   * Images and links are natively draggable, so pressing one and moving even a
   * few px hands the gesture to the browser's drag-and-drop: it cancels the
   * pointer stream and never fires the click, which ate both the carousel drag
   * and the cards' links.
   */
  const onDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  return (
    <div className={styles.page}>
      <div className={styles.dots} />

      <header className={styles.header}>
        <div>
          <div className={styles.brand}>
            <div className={styles.diamond} />
            <span className={styles.brandName}>Property Index</span>
          </div>
          <h1 className={styles.title}>FUTE SERVICES</h1>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- raw <img> to match ImageSlot; the logo is a bundled asset, so no optimisation is needed */}
        <img
          className={styles.corpLogo}
          src="/brand/hiranandani.png"
          width={142}
          height={66}
          alt="Fute Services"
          // No logo asset yet, so hide the broken image until /brand/hiranandani.png is added.
          onError={(e) => {
            e.currentTarget.style.display = "none";
          }}
        />
        <div className={styles.meta}>
          <div className={styles.counter}>
            <span>{pad2(index + 1)}</span>
            <span className={styles.counterTotal}>
              &nbsp;/&nbsp;{pad2(count)}
            </span>
          </div>
          <div className={styles.tagline}>Fute Services Portfolio &middot; 2026</div>
        </div>
      </header>

      <div
        ref={stageRef}
        className={styles.stage}
        onPointerDown={onPointerDown}
        onClickCapture={onClickCapture}
        onDragStart={onDragStart}
      >
        <div ref={scalerRef} className={styles.scaler}>
          <div ref={prismRef} className={styles.prism} data-animated="false">
            {properties.map((property, i) => {
              // Matches what render3d writes at angle 0, so SSR and first paint agree.
              const offset = wrapOffset(i, 0, count);
              return (
                <div
                  key={property.slug}
                  className={styles.face}
                  style={{ transform: faceTransform(offset) }}
                >
                  <div className={styles.card}>
                    <div className={styles.cardMedia}>
                      <ImageSlot
                        src={property.image}
                        placeholder={`${property.name} image`}
                        alt={`${property.name}, ${property.location}`}
                      />
                    </div>
                    <div className={styles.cardFoot}>
                      <div className={styles.cardLabel}>
                        <span className={styles.cardIndex}>{pad2(i + 1)}</span>
                        <h3 className={styles.cardName}>{property.name}</h3>
                      </div>
                      <a
                        className={styles.cardLink}
                        href={property.href}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Visit&nbsp;&#8599;
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <footer className={styles.footer}>
        <div className={styles.controls}>
          <div className={styles.buttons}>
            <button
              type="button"
              className={styles.navButton}
              aria-label="Previous property"
              onClick={() => nudge(-1)}
            >
              &#8592;
            </button>
            <button
              type="button"
              className={styles.navButton}
              aria-label="Next property"
              onClick={() => nudge(1)}
            >
              &#8594;
            </button>
          </div>
          <span className={styles.hint}>Drag to rotate &middot; or pick below</span>
        </div>
        <nav className={styles.list}>
          {properties.map((property, i) => (
            <button
              key={property.slug}
              type="button"
              className={styles.listItem}
              aria-current={i === index}
              onClick={() => goTo(i)}
            >
              <span className={styles.listIndex}>{pad2(i + 1)}</span>
              {property.listName ?? property.name}
            </button>
          ))}
        </nav>
      </footer>

      <button
        type="button"
        className={styles.signout}
        onClick={signOut}
        aria-label="Log out"
      >
        Log out ↗
      </button>
    </div>
  );
}
