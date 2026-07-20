import styles from "./ImageSlot.module.css";

type ImageSlotProps = {
  /** Caption shown while no image is set. */
  placeholder: string;
  src?: string;
  alt?: string;
};

/**
 * Fills its positioned parent. Stands in for the design's <image-slot>:
 * shows a captioned tile until a real image URL is available.
 */
export function ImageSlot({ placeholder, src, alt }: ImageSlotProps) {
  return (
    <div className={styles.slot}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- src is arbitrary/remote until media storage lands (TRD §2)
        <img className={styles.image} src={src} alt={alt ?? placeholder} />
      ) : (
        <span className={styles.placeholder}>{placeholder}</span>
      )}
    </div>
  );
}
