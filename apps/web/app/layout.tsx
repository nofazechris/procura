import "@fontsource-variable/inter";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Procura", template: "%s · Procura" },
  description: "An AI buyer for small businesses. It finds options, checks the evidence and spends only inside a limit you approve.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // data-theme is set by the inline script before paint, so React must not complain about it.
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} /></head>
      <body>{children}</body>
    </html>
  );
}
