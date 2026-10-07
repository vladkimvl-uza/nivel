import type { MetadataRoute } from "next";
import { robotsFor } from "../src/i18n/paths.ts";

/** `/robots.txt`: everything is open except the API; the sitemap is named. */
export default function robots(): MetadataRoute.Robots {
  return robotsFor(process.env.PUBLIC_BASE_URL ?? "https://nivel.uz");
}
