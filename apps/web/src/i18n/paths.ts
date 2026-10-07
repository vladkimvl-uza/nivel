// The public paths of the one-page site and what a search engine is told about them (ARCHITECTURE 5.1, 5.2): the paths are
// neutral Latin and the same in both languages, `alternates.languages` carries hreflang with x-default to Uzbek.
import { locales } from "@nivel/i18n";

/** Below the locale: the home page, the legal documents of R0 and the requisites. */
export const PUBLIC_PATHS = [
  "",
  "/legal/offer",
  "/legal/privacy",
  "/legal/warranty",
  "/legal/returns",
  "/legal/consent-pd",
  "/legal/stage-tariff",
  "/requisites",
] as const;

export interface Alternates {
  languages: Record<string, string>;
}

/** hreflang of a page: every language and x-default (Uzbek), as paths (Next completes them with `metadataBase`). */
export function alternatesFor(path: string): Alternates {
  return {
    languages: { ...Object.fromEntries(locales.map((l) => [l, `/${l}${path}`])), "x-default": `/uz${path}` },
  };
}

export interface SitemapEntry {
  url: string;
  lastModified?: Date;
  alternates: Alternates;
}

/** The public address of the site from the environment (`PUBLIC_BASE_URL`): its origin, or null when it is not an http(s) address. */
export function publicBaseOf(raw: string | undefined): string | null {
  const text = raw?.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

const trimBase = (base: string): string => base.replace(/\/+$/, "");

/** One entry for every path and language, Uzbek first, with absolute hreflang addresses. */
export function sitemapFor(base: string, lastModified?: Date): SitemapEntry[] {
  const origin = trimBase(base);
  return PUBLIC_PATHS.flatMap((path) =>
    locales.map((locale) => ({
      url: `${origin}/${locale}${path}`,
      ...(lastModified ? { lastModified } : {}),
      alternates: {
        languages: Object.fromEntries(
          Object.entries(alternatesFor(path).languages).map(([lang, href]) => [lang, `${origin}${href}`]),
        ),
      },
    })),
  );
}

export function robotsFor(base: string): {
  rules: { userAgent: string; allow: string; disallow: string[] }[];
  sitemap: string;
} {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    sitemap: `${trimBase(base)}/sitemap.xml`,
  };
}
