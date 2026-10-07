import type { MetadataRoute } from "next";
import { publicBaseOf, sitemapFor } from "../src/i18n/paths.ts";

// Read at every request: the address is the one of the server that serves it, not the one of the machine that built the image.
export const dynamic = "force-dynamic";

/** `/sitemap.xml`: every public path in both languages with hreflang (ARCHITECTURE 5.1). */
export default function sitemap(): MetadataRoute.Sitemap {
  return sitemapFor(publicBaseOf(process.env.PUBLIC_BASE_URL) ?? "https://nivel.uz");
}
