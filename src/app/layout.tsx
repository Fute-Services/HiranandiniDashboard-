import type { Metadata } from "next";
import { Cormorant_Garamond, Inter, JetBrains_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { KickWatcher } from "@/components/KickWatcher";
import { IdleLogoutWatcher } from "@/components/IdleLogoutWatcher";
import "./globals.css";

/**
 * Three typefaces, each with one job — the old single-grotesk setup gave
 * headlines, body copy and data the same voice, which is most of what made
 * every screen read as one flat wall of text.
 *
 * Display is a serif on purpose: this is a product shown to someone buying a
 * home, and a geometric sans headline reads like a developer tool. The serif
 * carries the "estate" register; Inter does the actual work; the mono is for
 * IDs, timers and counts, where tabular figures matter more than character.
 */
const display = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const sans = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Fute Services | Property Index",
  description:
    "A showcase of the Fute Services property portfolio. Browse each property and continue to its own site.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      /* `--font-grotesk` and `--font-jetbrains` are the names the existing
         stylesheets ask for. Aliasing them here rather than renaming ~130
         call sites keeps this change to the type system itself. */
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
    >
      <body>
        <KickWatcher />
        <IdleLogoutWatcher />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
