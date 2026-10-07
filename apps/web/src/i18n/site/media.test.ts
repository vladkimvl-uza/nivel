import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CACHE_CONTROL, contentTypeOf, parseRange, resolveMediaFile, resolveMediaRoot, serveMedia } from "./media.ts";

describe("resolveMediaRoot", () => {
  const exists = (set: string[]) => (p: string) => set.includes(p.split(sep).join("/"));

  it("takes MEDIA_DIR when it is an existing absolute folder", () => {
    expect(resolveMediaRoot({ MEDIA_DIR: "/srv/media" }, "/app", exists(["/srv/media"]))).toBe(join("/srv/media"));
  });

  it("looks for a relative MEDIA_DIR from the working folder upwards (the standalone server starts deep in .next)", () => {
    const where = exists(["/repo/.data/media"]);
    expect(resolveMediaRoot({ MEDIA_DIR: ".data/media" }, "/repo/apps/web/.next/standalone/apps/web", where)).toBe(
      join("/repo/.data/media"),
    );
  });

  it("falls back to the folder of the design prototype when MEDIA_DIR is not set", () => {
    const where = exists(["/repo/docs/design/hero-video/media"]);
    expect(resolveMediaRoot({}, "/repo/apps/web", where)).toBe(join("/repo/docs/design/hero-video/media"));
  });

  it("falls back to the prototype folder when MEDIA_DIR points nowhere", () => {
    const where = exists(["/repo/docs/design/hero-video/media"]);
    expect(resolveMediaRoot({ MEDIA_DIR: "nowhere" }, "/repo/apps/web", where)).toBe(
      join("/repo/docs/design/hero-video/media"),
    );
  });

  it("is null when there is no media at all (the site then works on its static look)", () => {
    expect(resolveMediaRoot({}, "/repo/apps/web", exists([]))).toBeNull();
    expect(resolveMediaRoot({ MEDIA_DIR: "   " }, "/repo", exists([]))).toBeNull();
  });
});

describe("resolveMediaFile", () => {
  const root = join(tmpdir(), "nivel-media-root");

  it("gives the file inside the root", () => {
    expect(resolveMediaFile(root, ["posters", "step01-brand-1280.webp"])).toBe(
      join(root, "posters", "step01-brand-1280.webp"),
    );
    expect(resolveMediaFile(root, ["nivel-night-brand-1280.mp4"])).toBe(join(root, "nivel-night-brand-1280.mp4"));
  });

  it.each([
    [[".."]],
    [["..", "secret.mp4"]],
    [["posters", "..", "..", "x.mp4"]],
    [["posters/../x.mp4"]],
    [["posters\\..\\x.mp4"]],
    [["C:", "x.mp4"]],
    [["a.mp4\0.png"]],
    [[""]],
    [[]],
    [[".hidden.mp4"]],
    [["a.txt"]],
    [["a.mp4.exe"]],
    [["a"]],
    [["a.MP4x"]],
  ])("refuses %j", (segments) => {
    expect(resolveMediaFile(root, segments)).toBeNull();
  });

  it("takes the extensions of the media in any case", () => {
    expect(resolveMediaFile(root, ["a.MP4"])).toBe(join(root, "a.MP4"));
    expect(resolveMediaFile(root, ["a.webp"])).not.toBeNull();
    expect(resolveMediaFile(root, ["a.png"])).not.toBeNull();
    expect(resolveMediaFile(root, ["a.avif"])).not.toBeNull();
  });
});

describe("contentTypeOf", () => {
  it("knows the types of the media", () => {
    expect(contentTypeOf("a.mp4")).toBe("video/mp4");
    expect(contentTypeOf("a.webp")).toBe("image/webp");
    expect(contentTypeOf("a.png")).toBe("image/png");
    expect(contentTypeOf("a.jpg")).toBe("image/jpeg");
    expect(contentTypeOf("a.avif")).toBe("image/avif");
    expect(contentTypeOf("a.webm")).toBe("video/webm");
    expect(contentTypeOf("a.bin")).toBe("application/octet-stream");
  });
});

describe("parseRange", () => {
  it.each([
    ["bytes=0-99", 1000, { kind: "partial", start: 0, end: 99 }],
    ["bytes=500-", 1000, { kind: "partial", start: 500, end: 999 }],
    ["bytes=-100", 1000, { kind: "partial", start: 900, end: 999 }],
    ["bytes=0-5000", 1000, { kind: "partial", start: 0, end: 999 }],
    ["bytes=999-999", 1000, { kind: "partial", start: 999, end: 999 }],
    ["bytes=-5000", 1000, { kind: "partial", start: 0, end: 999 }],
    ["bytes=0-0", 1, { kind: "partial", start: 0, end: 0 }],
  ] as const)("reads %j on %d bytes", (header, size, expected) => {
    expect(parseRange(header, size)).toEqual(expected);
  });

  it.each([
    ["bytes=1000-", 1000],
    ["bytes=2000-3000", 1000],
    ["bytes=-0", 1000],
    ["bytes=0-0", 0],
    ["bytes=5-2", 1000],
  ])("cannot satisfy %j on %d bytes", (header, size) => {
    expect(parseRange(header, size)).toEqual({ kind: "unsatisfiable" });
  });

  it.each([null, "", "bytes=", "items=0-1", "bytes=a-b", "bytes=0-1,5-9", "bytes=--1", "bytes=1.5-2"])(
    "serves the whole file for %j",
    (header) => {
      expect(parseRange(header, 1000)).toEqual({ kind: "full" });
    },
  );
});

describe("serveMedia", () => {
  const dir = mkdtempSync(join(tmpdir(), "nivel-media-"));
  const bytes = Buffer.from("0123456789abcdefghij"); // 20 bytes

  beforeAll(() => {
    mkdirSync(join(dir, "posters"));
    writeFileSync(join(dir, "posters", "p.webp"), bytes);
    writeFileSync(join(dir, "clip.mp4"), bytes);
    mkdirSync(join(dir, "folder.mp4"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const get = (path: string[], headers: Record<string, string> = {}, method = "GET") =>
    serveMedia(new Request("http://localhost/media/x", { method, headers }), dir, path);

  it("serves a whole file with the headers CDN and browsers need: types, immutable cache, ranges", async () => {
    const res = await get(["posters", "p.webp"]);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("content-length")).toBe("20");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("cache-control")).toBe(CACHE_CONTROL);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("0123456789abcdefghij");
  });

  it("uses immutable caching for a year", () => {
    expect(CACHE_CONTROL).toBe("public, max-age=31536000, immutable");
  });

  it("serves a range as 206 with Content-Range", async () => {
    const res = await get(["clip.mp4"], { range: "bytes=5-9" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 5-9/20");
    expect(res.headers.get("content-length")).toBe("5");
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("56789");
  });

  it("serves the tail of a file for an open range", async () => {
    const res = await get(["clip.mp4"], { range: "bytes=15-" });
    expect(res.status).toBe(206);
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe("fghij");
  });

  it("answers 416 for a range behind the end", async () => {
    const res = await get(["clip.mp4"], { range: "bytes=20-30" });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */20");
  });

  it("answers HEAD without a body", async () => {
    const res = await get(["clip.mp4"], {}, "HEAD");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-length")).toBe("20");
    expect(await res.text()).toBe("");
  });

  it("answers 404 for a missing file, a folder, a bad path and a missing root, with no detail", async () => {
    expect((await get(["nope.mp4"])).status).toBe(404);
    expect((await get(["folder.mp4"])).status).toBe(404);
    expect((await get(["..", "x.mp4"])).status).toBe(404);
    const noRoot = await serveMedia(new Request("http://localhost/media/x"), null, ["clip.mp4"]);
    expect(noRoot.status).toBe(404);
    expect(await noRoot.text()).toBe("");
  });

  it("answers 405 to a method that is not GET or HEAD", async () => {
    const res = await get(["clip.mp4"], {}, "POST");
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
  });
});
