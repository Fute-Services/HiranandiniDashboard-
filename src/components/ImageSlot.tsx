"use client";

import { useEffect, useState } from "react";
import styles from "./ImageSlot.module.css";

type ImageSlotProps = {
  /** Caption shown while no image is set. */
  placeholder: string;
  src?: string;
  alt?: string;
  /** "cover" (default) fills the box, cropping whatever doesn't fit — right
   * for photos and small thumbnails. "contain" letterboxes instead, for
   * spots (like a large hero card) where cropping a wide architectural
   * elevation or site-plan render would cut off labels/edges that actually
   * matter. */
  fit?: "cover" | "contain";
};

/**
 * Fills its positioned parent. Stands in for the design's <image-slot>:
 * shows a captioned tile until a real image URL is available.
 *
 * A remote image can take a moment on a showroom connection, so the slot
 * keeps its shimmer running (and holds the image hidden) until that image
 * has actually decoded — otherwise a card reads as broken/empty rather than
 * loading, and then pops in with no warning.
 */
export function ImageSlot({ placeholder, src, alt, fit = "cover" }: ImageSlotProps) {
  const [loaded, setLoaded] = useState(false);

  // A new src means a new load: drop back to the shimmer instead of showing
  // the previous project's image while this one is still on the wire.
  useEffect(() => {
    setLoaded(false);
  }, [src]);

  return (
    <div className={`${styles.slot} ${src && !loaded ? styles.slotLoading : ""}`}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- src is arbitrary/remote until media storage lands (TRD §2)
        <img
          className={`${styles.image} ${loaded ? styles.imageLoaded : ""}`}
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
