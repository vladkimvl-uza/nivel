import type { MetadataRoute } from "next";
import { publicBaseOf, robotsFor } from "../src/i18n/paths.ts";

// Read at every request, like the sitemap.
export const dynamic = "force-dynamic";

/** `/robots.txt`: everything is open except the API; the sitemap is named. */
export default function robots(): MetadataRoute.Robots {
  return robotsFor(publicBaseOf(process.env.PUBLIC_BASE_URL) ?? "https://nivel.uz");
}
