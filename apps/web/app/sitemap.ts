import type { MetadataRoute } from "next";
import { sitemapFor } from "../src/i18n/paths.ts";
import { todayInTashkent } from "../src/i18n/site/data.ts";

/** `/sitemap.xml`: every public path in both languages with hreflang (ARCHITECTURE 5.1). */
export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapFor(process.env.PUBLIC_BASE_URL ?? "https://nivel.uz", new Date(todayInTashkent()));
}
