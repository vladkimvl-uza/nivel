import { describe, expect, it } from "vitest";
import { alternatesFor, PUBLIC_PATHS, publicBaseOf, robotsFor, sitemapFor } from "./paths.ts";

describe("PUBLIC_PATHS", () => {
  it("lists the home page, the legal pages and the requisites, with neutral Latin paths", () => {
    expect(PUBLIC_PATHS).toEqual([
      "",
      "/legal/offer",
      "/legal/privacy",
      "/legal/warranty",
      "/legal/returns",
      "/legal/consent-pd",
      "/legal/stage-tariff",
      "/requisites",
    ]);
    for (const p of PUBLIC_PATHS) expect(p).toMatch(/^(?:|\/[a-z-]+(?:\/[a-z-]+)?)$/);
  });
});

describe("alternatesFor", () => {
  it("points each language and x-default (Uzbek) at the same path", () => {
    expect(alternatesFor("/legal/offer")).toEqual({
      languages: { uz: "/uz/legal/offer", ru: "/ru/legal/offer", "x-default": "/uz/legal/offer" },
    });
    expect(alternatesFor("").languages.uz).toBe("/uz");
  });
});

describe("sitemapFor", () => {
  const at = new Date("2026-10-07T00:00:00Z");
  const entries = sitemapFor("https://nivel.uz/", at);

  it("has every path in both languages, Uzbek first", () => {
    expect(entries).toHaveLength(PUBLIC_PATHS.length * 2);
    expect(entries.slice(0, 2).map((e) => e.url)).toEqual(["https://nivel.uz/uz", "https://nivel.uz/ru"]);
    expect(entries.at(-1)?.url).toBe("https://nivel.uz/ru/requisites");
  });

  it("gives every entry the alternates of the other language (hreflang) with absolute addresses", () => {
    for (const e of entries) {
      expect(e.alternates?.languages).toMatchObject({
        uz: expect.stringMatching(/^https:\/\/nivel\.uz\/uz/),
        ru: expect.stringMatching(/^https:\/\/nivel\.uz\/ru/),
      });
    }
    expect(entries[1]?.alternates?.languages).toEqual({
      uz: "https://nivel.uz/uz",
      ru: "https://nivel.uz/ru",
      "x-default": "https://nivel.uz/uz",
    });
  });

  it("carries the date of the last change", () => {
    for (const e of entries) expect(e.lastModified).toEqual(at);
  });

  it("does not double the slash of the base", () => {
    expect(sitemapFor("https://nivel.uz///", at)[0]?.url).toBe("https://nivel.uz/uz");
  });
});

describe("publicBaseOf", () => {
  it("takes the origin of a good address, without the path and the closing slash", () => {
    expect(publicBaseOf("https://nivel.uz")).toBe("https://nivel.uz");
    expect(publicBaseOf("https://nivel.uz/")).toBe("https://nivel.uz");
    expect(publicBaseOf(" http://localhost:3500/x/y ")).toBe("http://localhost:3500");
  });

  it.each([
    undefined,
    "",
    "   ",
    "nivel.uz",
    "ftp://nivel.uz",
    "javascript:alert(1)",
    "http://",
    "https://exa mple.uz",
  ])("gives nothing for %j, so that a typo in the environment cannot turn every page into an error", (raw) => {
    expect(publicBaseOf(raw)).toBeNull();
  });
});

describe("sitemapFor without a date", () => {
  it("leaves lastmod out: the page does not know when its text changed, and a made-up date would mislead the crawler", () => {
    const entries = sitemapFor("https://nivel.uz");
    expect(entries).toHaveLength(PUBLIC_PATHS.length * 2);
    for (const e of entries) expect("lastModified" in e).toBe(false);
  });
});

describe("robotsFor", () => {
  it("lets everything be read except the API and the internal media route, and names the sitemap", () => {
    expect(robotsFor("https://nivel.uz")).toEqual({
      rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
      sitemap: "https://nivel.uz/sitemap.xml",
    });
  });
});
