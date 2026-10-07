import { htmlLang, isLocale, locales } from "@nivel/i18n";
import { defaultTheme, themeTokens } from "@nivel/ui";
import { StampInkDefs } from "@nivel/ui/react";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { alternatesFor } from "../../src/i18n/paths.ts";
import { MOTION_COOKIE, readMotionPrefs } from "../../src/i18n/site/prefs.ts";
import "./globals.css";

// Fonts of the night design system (packages/ui/fonts, ADR-006): own woff2 through next/font/local. One face is preloaded, the
// text face; the others are fetched when the page uses them (`display: swap`). The names of the faces are put into the
// variables --font-* and picked up by --display, --sans, --cond, --mono in globals.css.
const text = localFont({
  src: [
    { path: "../../../../packages/ui/fonts/fira-sans-400.woff2", weight: "400", style: "normal" },
    { path: "../../../../packages/ui/fonts/fira-sans-500.woff2", weight: "500", style: "normal" },
  ],
  display: "swap",
  preload: true,
  variable: "--font-text",
});
const display = localFont({
  src: [{ path: "../../../../packages/ui/fonts/brygada-1918-500.woff2", weight: "500", style: "normal" }],
  display: "swap",
  preload: false,
  variable: "--font-display",
});
const condensed = localFont({
  src: [
    { path: "../../../../packages/ui/fonts/fira-sans-extra-condensed-600.woff2", weight: "600", style: "normal" },
    { path: "../../../../packages/ui/fonts/fira-sans-extra-condensed-700.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  preload: false,
  variable: "--font-cond",
});
const mono = localFont({
  src: [
    { path: "../../../../packages/ui/fonts/ibm-plex-mono-400.woff2", weight: "400", style: "normal" },
    { path: "../../../../packages/ui/fonts/ibm-plex-mono-500.woff2", weight: "500", style: "normal" },
  ],
  display: "swap",
  preload: false,
  variable: "--font-mono",
});
// In IBM Plex Mono the sign U+02BB looks like an acute accent: Uzbek text uses Noto Sans Mono (themes.css).
const monoUz = localFont({
  src: [
    { path: "../../../../packages/ui/fonts/noto-sans-mono-400.woff2", weight: "400", style: "normal" },
    { path: "../../../../packages/ui/fonts/noto-sans-mono-500.woff2", weight: "500", style: "normal" },
  ],
  display: "swap",
  preload: false,
  variable: "--font-mono-uz",
});

/** The mark as a favicon, inline: the site has no file for it, and a request for /favicon.ico would be a 404 on every page. */
const FAVICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill='%23F1EFEA' d='M2 4h13v2h-13Z'/%3E%3Cpath fill='%23F06A30' d='M2 6L10 6L6 10Z'/%3E%3Cpath fill='%23F1EFEA' d='M1 10h14v2h-14Z'/%3E%3C/svg%3E";

const FONT_CLASSES = [text, display, condensed, mono, monoUz].map((f) => f.variable).join(" ");

/** Before the first paint: the page is `js` (it may run the pinned scroll) unless the visitor wants less motion or saves traffic. */
const BOOT = `(function(d){d.classList.add("js");try{var c=navigator.connection;if(matchMedia("(prefers-reduced-motion: reduce)").matches||(c&&c.saveData))d.classList.add("is-reduced")}catch(e){}})(document.documentElement)`;

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "site.meta" });
  const base = process.env.PUBLIC_BASE_URL;
  return {
    ...(base ? { metadataBase: new URL(base) } : {}),
    title: { default: t("title"), template: "%s — Nivel" },
    description: t("description"),
    icons: { icon: FAVICON },
    alternates: alternatesFor(""),
    openGraph: {
      title: t("title"),
      description: t("description"),
      type: "website",
      locale: htmlLang[locale].replace("-", "_"),
    },
  };
}

export const viewport: Viewport = {
  themeColor: themeTokens[defaultTheme].themeColor,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  // Reading the request makes the page dynamic, so Next stamps the CSP nonce on its scripts.
  const h = await headers();
  const nonce = h.get("x-nonce") ?? undefined;
  const prefs = readMotionPrefs((await cookies()).get(MOTION_COOKIE)?.value, h.get("save-data"));

  return (
    <html
      lang={htmlLang[locale]}
      data-theme={defaultTheme}
      className={`${FONT_CLASSES}${prefs.reduced ? " is-reduced" : ""}`}
      data-nonce-present={nonce ? "1" : "0"}
    >
      <head>
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: BOOT }} />
      </head>
      <body>
        <StampInkDefs />
        {children}
      </body>
    </html>
  );
}
