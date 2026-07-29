import type { Metadata } from "next";
import { Space_Grotesk, Space_Mono } from "next/font/google";
import { KickWatcher } from "@/components/KickWatcher";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-grotesk",
  display: "swap",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Hiranandani | Property Index",
  description:
    "A showcase of the Hiranandani property portfolio. Browse each property and continue to its own site.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${spaceMono.variable}`}>
      <body>
        <KickWatcher />
        {children}
      </body>
    </html>
  );
}
