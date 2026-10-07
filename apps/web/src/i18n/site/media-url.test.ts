import { describe, expect, it } from "vitest";
import { internalMediaPath, mediaBaseOf, mediaUrl } from "./media-url.ts";

describe("mediaBaseOf", () => {
  it("takes a path of the site from MEDIA_BASE_URL and cuts the closing slash", () => {
    expect(mediaBaseOf({ MEDIA_BASE_URL: "/m/" })).toBe("/m");
  });

  it("does not take the address of another host: the policy of the page would block every picture and clip from it", () => {
    for (const raw of ["https://cdn.example/media/", "http://cdn.example/m"]) {
      expect(mediaBaseOf({ MEDIA_BASE_URL: raw })).toBe("/media");
    }
  });

  it("falls back to /media for nothing, for text that is not an address and for a dangerous one", () => {
    for (const raw of [undefined, "", "  ", "media", "javascript:alert(1)", "//evil.example/x", "/a b", "ftp://x/y"]) {
      expect(mediaBaseOf({ MEDIA_BASE_URL: raw })).toBe("/media");
    }
  });
});

describe("internalMediaPath", () => {
  it("sends /media/* to the internal route and leaves everything else alone", () => {
    expect(internalMediaPath("/media/bg/x-d.mp4")).toBe("/api/internal/media/bg/x-d.mp4");
    expect(internalMediaPath("/media/a.webp")).toBe("/api/internal/media/a.webp");
    expect(internalMediaPath("/media/")).toBeNull();
    expect(internalMediaPath("/media")).toBeNull();
    expect(internalMediaPath("/uz/media/x.mp4")).toBeNull();
    expect(internalMediaPath("/mediaX/x.mp4")).toBeNull();
    expect(internalMediaPath("/api/internal/media/x.mp4")).toBeNull();
  });
});

describe("mediaUrl", () => {
  it("joins the base of the media and a path inside it", () => {
    expect(mediaUrl("/media", "posters/step01-brand-1280.webp")).toBe("/media/posters/step01-brand-1280.webp");
    expect(mediaUrl("/media/", "/bg/k-d.webp")).toBe("/media/bg/k-d.webp");
    expect(mediaUrl("https://cdn.example/media", "a.mp4")).toBe("https://cdn.example/media/a.mp4");
  });
});
