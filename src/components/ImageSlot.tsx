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
 */
export function ImageSlot({ placeholder, src, alt, fit = "cover" }: ImageSlotProps) {
  return (
    <div className={styles.slot}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- src is arbitrary/remote until media storage lands (TRD §2)
        <img
          className={styles.image}
          style={{ objectFit: fit }}
          src={src}
          alt={alt ?? placeholder}
        />
      ) : (
        <span className={styles.placeholder}>{placeholder}</span>
      )}
    </div>
  );
}
