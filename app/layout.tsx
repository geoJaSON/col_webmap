import type { Metadata, Viewport } from "next";
import { Archivo_Narrow, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";

import "./globals.css";

const label = Archivo_Narrow({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-label",
});

const body = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "COL Status",
  description: "TPWD Certificate of Location applications by status, entity, and bay system.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // No maximum-scale: pinch-zoom stays available. MapLibre consumes pinch
  // gestures over the canvas itself, so this only affects the panel text.
  themeColor: "#0f1d26",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${label.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
