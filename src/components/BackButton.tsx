"use client";

import { useRouter } from "next/navigation";
import styles from "./BackButton.module.css";

/**
 * A single reusable back control (browser history back), a small dark glass
 * circle so it reads on every page in the app (they're all dark themed).
 *
 * Two placements, chosen per page rather than guessed with fixed coordinates
 * everywhere: `floating` (the default) is for pages with an empty top-left
 * corner (nothing else lives there) — it's absolutely positioned. Pages that
 * already have a header row instead render this as a normal flex item
 * inside that row (`floating={false}`), which guarantees it can never
 * overlap that header's own content, since it's part of the same layout
 * flow rather than an overlay guessing at coordinates.
 */
export function BackButton({ floating = true }: { floating?: boolean } = {}) {
  const router = useRouter();

  return (
    <button
      type="button"
      className={`${styles.back} ${floating ? styles.floating : ""}`}
      onClick={() => router.back()}
      aria-label="Go back"
    >
      &#8592;
    </button>
  );
}
