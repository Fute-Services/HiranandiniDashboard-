import Link from "next/link";
import { LOGIN_PATH } from "@/lib/auth";
import styles from "./IntroSplash.module.css";

/**
 * First thing every visitor sees: a black screen that fades in the
 * Hiranandani logo, then an Enter button that leads to the login page.
 * Pure CSS animation (delayed keyframes) — no client JS needed. No back
 * button here — it's the very first screen, there's nothing before it.
 */
export function IntroSplash() {
  return (
    <div className={styles.page}>
      {/* eslint-disable-next-line @next/next/no-img-element -- bundled brand asset, matches the raw <img> used elsewhere for the logo */}
      <img className={styles.logo} src="/brand/hiranandani-logo.png" alt="Hiranandani Communities" />
      <Link href={LOGIN_PATH} className={styles.enter}>
        Enter
      </Link>
    </div>
  );
}
