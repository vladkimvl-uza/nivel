import { htmlLang, isLocale, locales } from "@nivel/i18n";
import { defaultTheme } from "@nivel/ui";
import type { Metadata } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import "./globals.css";

// Spike (BUILD_PLAN 4.2, fonts): fonts of theme B through next/font/local; only the main text face is preloaded.
// next/font does not expose the file URL, so a hand-written <link rel="preload"> is impossible without a second
// copy of the file: the fallback from the spike table is used (see docs/arch/ADR-006). WP-09 owns the font set.
const textFont = localFont({
  src: "../../../../packages/ui/fonts/fira-sans-latin-400-normal.woff2",
  weight: "400",
  display: "swap",
  preload: true,
  variable: "--nv-font-text",
});
const textFontSemibold = localFont({
  src: "../../../../packages/ui/fonts/fira-sans-latin-600-normal.woff2",
  weight: "600",
  display: "swap",
  preload: false,
  variable: "--nv-font-text-semibold",
});

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "common.meta" });
  return {
    title: t("title"),
    description: t("description"),
    alternates: { languages: { uz: "/uz", ru: "/ru", "x-default": "/uz" } },
  };
}

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
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang={htmlLang[locale]}
      data-theme={defaultTheme}
      className={`${textFont.variable} ${textFontSemibold.variable}`}
      data-nonce-present={nonce ? "1" : "0"}
    >
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
