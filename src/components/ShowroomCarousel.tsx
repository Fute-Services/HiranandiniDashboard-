"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Property } from "@/data/properties";
import { ImageSlot } from "./ImageSlot";
import styles from "./ShowroomCarousel.module.css";

/**
 * Coverflow arc rather than a closed prism ring, for the same reason
 * PropertyCarousel uses one: a ring only reads well when neighbours sit
 * within ~50° of the front, and a portfolio of two or three projects would
 * put them past the backface cutoff, leaving a single visible card.
 */
const SPACING = 400; // px along X per card of offset
const DEPTH = 190; // px pushed back per card of offset
const TILT = 42; // deg turned away per card of offset
const DESIGN_WIDTH = 2 * SPACING + 420; // centre card + a neighbour either side
const AUTO_SPEED = 0.0031; // cards per frame
const RESUME_DELAY = 4000;
/** px of travel before a press counts as a drag rather than a click. */
const DRAG_THRESHOLD = 12;

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Signed distance from `position` to card `i`, wrapped so the arc loops. */
function wrapOffset(i: number, position: number, count: number) {
  const half = count / 2;
  return ((((i - position + half) % count) + count) % count) - half;
}

function faceTransform(offset: number) {
  return (
    `translateX(${(offset * SPACING).toFixed(1)}px) ` +
    `translateZ(${(-Math.abs(offset) * DEPTH).toFixed(1)}px) ` +
    `rotateY(${(-offset * TILT).toFixed(2)}deg)`
  );
}

/**
 * The showroom's project picker: a draggable horizontal arc of cards with the
 * chosen one facing front, plus arrows and a name list underneath. Dark-themed
 * to sit on the portal's own backdrop.
 *
 * `onIndexChange` exists so the screen's header counter can track the front
 * card without this component owning the header.
 */
export function ShowroomCarousel({
  projects,
  onOpen,
  onIndexChange,
}: {
  projects: Property[];
  onOpen: (property: Property) => void;
  onIndexChange?: (index: number) => void;
}) {
  const count = projects.length;

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

  useEffect(() => {
    onIndexChange?.(index);
  }, [index, onIndexChange]);

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
      if (count < 2) return;
      snapTo(Math.round(positionRef.current) + dir);
    },
    [count, snapTo],
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

  // Scale the whole stage down on narrow viewports so the arc never crops.
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
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) {
        return;
      }
      if (e.key === "ArrowRight") nudge(1);
      else if (e.key === "ArrowLeft") nudge(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nudge]);

  useEffect(() => {
    setAnimated(false);
    render3d();

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion || count < 2) {
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
  }, [count, render3d, setAnimated]);

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
   * pointer stream and never fires the click, which ate both the drag and the
   * cards' links.
   */
  const onDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  return (
    <div className={styles.wrap}>
      <div
        ref={stageRef}
        className={styles.stage}
        onPointerDown={onPointerDown}
        onClickCapture={onClickCapture}
        onDragStart={onDragStart}
      >
        <div ref={scalerRef} className={styles.scaler}>
          <div ref={prismRef} className={styles.prism} data-animated="false">
            {projects.map((property, i) => {
              // Matches what render3d writes at position 0, so SSR and first
              // paint agree.
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
                        fit="contain"
                        instant
                      />
                    </div>
                    <div className={styles.cardFoot}>
                      <div className={styles.cardLabel}>
                        <span className={styles.cardIndex}>{pad2(i + 1)}</span>
                        <h3 className={styles.cardName}>{property.name}</h3>
                      </div>
                      <button
                        type="button"
                        className={styles.cardLink}
                        onClick={() => onOpen(property)}
                      >
                        Visit&nbsp;&#8599;
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className={styles.controls}>
        <div className={styles.buttons}>
          <button
            type="button"
            className={styles.navButton}
            aria-label="Previous project"
            onClick={() => nudge(-1)}
            disabled={count < 2}
          >
            &#8592;
          </button>
          <button
            type="button"
            className={styles.navButton}
            aria-label="Next project"
            onClick={() => nudge(1)}
            disabled={count < 2}
          >
            &#8594;
          </button>
        </div>
        <span className={styles.hint}>
          {count > 1 ? <>Drag to rotate &middot; or pick below</> : "Only project in this portfolio"}
        </span>
      </div>

      <nav className={styles.list}>
        {projects.map((property, i) => (
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
    </div>
  );
}
