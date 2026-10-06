import "@nivel/ui/styles.css";
import "../src/kit/ui/admin.css";
import { defaultTheme } from "@nivel/ui";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

// Owner admin: Russian only, one night theme (ADR-006), never indexed (ARCHITECTURE 6.1).
export const metadata: Metadata = {
  title: { default: "Nivel — админка", template: "%s · Nivel админка" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, colorScheme: "dark" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru" data-theme={defaultTheme}>
      <body>{children}</body>
    </html>
  );
}
