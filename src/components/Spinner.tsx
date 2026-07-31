import styles from "./Spinner.module.css";

/**
 * The app's single loading indicator, so every "something is happening"
 * moment reads the same way wherever it shows up. It draws itself in
 * `currentColor`, which is what lets one component sit inside a dark navbar
 * button, a bright blue submit button and a light showroom card without any
 * per-place colour overrides.
 */
export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`${styles.spinner} ${className ?? ""}`}
      style={{ width: size, height: size, borderWidth: Math.max(1.5, size / 7) }}
    />
  );
}

/**
 * Centred spinner + caption, for a panel or section that hasn't got its data
 * back yet. Used instead of rendering the empty state early — "no sessions
 * logged yet" and "not loaded yet" look identical otherwise, and the first
 * one is a lie while the request is still in flight.
 */
export function LoadingBlock({
  message = "Loading…",
  size = 20,
}: {
  message?: string;
  size?: number;
}) {
  return (
    <div className={styles.block} role="status">
      <Spinner size={size} />
      <span className={styles.blockLabel}>{message}</span>
    </div>
  );
}

/**
 * Blocking full-screen loader, for the handful of moments where the whole app
 * is mid-transition and there's nothing useful to interact with underneath
 * (a force-logout tearing the session down, for instance).
 */
export function FullScreenLoader({ message }: { message: string }) {
  return (
    <div className={styles.overlay} role="status" aria-live="polite">
      <Spinner size={26} />
      <span className={styles.overlayLabel}>{message}</span>
    </div>
  );
}
