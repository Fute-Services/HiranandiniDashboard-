import { useEffect, useState } from "react";
import styles from "./ImageSlot.module.css";

/**
 * Fills its positioned parent. Stands in for the design's <image-slot>:
 * shows a captioned tile until a real image URL is available.
 *
 * A remote image can take a moment on a showroom connection, so the slot
 * keeps its shimmer running (and holds the image hidden) until that image
 * has actually decoded — otherwise a card reads as broken/empty rather than
 * loading, and then pops in with no warning.
 *
 * Props:
 * - `placeholder` — caption shown while no image is set.
 * - `fit` — "cover" (default) fills the box, cropping whatever doesn't fit,
 *   which is right for photos and small thumbnails. "contain" letterboxes
 *   instead, for spots (like a large hero card) where cropping a wide
 *   architectural elevation or site-plan render would cut off labels/edges
 *   that actually matter.
 * - `instant` — skips the shimmer-then-fade handover and paints the image as
 *   soon as the browser has it. For screens that would rather show a picture
 *   arriving in pieces than sit behind a loading tile.
 */
export function ImageSlot({ placeholder, src, alt, fit = "cover", instant = false }) {
  const [loaded, setLoaded] = useState(false);
  const revealed = instant || loaded;

  // A new src means a new load: drop back to the shimmer instead of showing
  // the previous project's image while this one is still on the wire.
  useEffect(() => {
    setLoaded(false);
  }, [src]);

  return (
    <div className={`${styles.slot} ${src && !revealed ? styles.slotLoading : ""}`}>
      {src ? (
        <img
          className={`${styles.image} ${revealed ? styles.imageLoaded : ""}`}
          style={{ objectFit: fit }}
          src={src}
          alt={alt ?? placeholder}
          onLoad={() => setLoaded(true)}
          // A broken URL shouldn't shimmer forever — settle on the (empty)
          // image rather than pretending it's still coming.
          onError={() => setLoaded(true)}
        />
      ) : (
        <span className={styles.placeholder}>{placeholder}</span>
      )}
    </div>
  );
}
