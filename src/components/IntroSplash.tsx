import Link from "next/link";
import { LOGIN_PATH } from "@/lib/auth";
import styles from "./IntroSplash.module.css";

/**
 * First thing every visitor sees: a black screen that fades in the
 * Fute Services logo, then an Enter button that leads to the login page.
 * Pure CSS animation (delayed keyframes), so no client JS is needed. There's
 * no back button here since it's the very first screen; nothing comes before it.
 */
export function IntroSplash() {
  return (
    <div className={styles.page}>
      {/* eslint-disable-next-line @next/next/no-img-element -- bundled brand asset, matches the raw <img> used elsewhere for the logo */}
      <img className={styles.logo} src="/brand/hiranandani-logo.png" alt="Fute Services" />
      <Link href={LOGIN_PATH} className={styles.enter}>
        Enter
      </Link>
    </div>
  );
}
