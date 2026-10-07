// The media of the first screen and of the background (videos and posters of the owner and of the stock, ARCHITECTURE 5.6):
// they are not in git (public repository, licences of the stock). In production Caddy serves the volume `media` at /media with
// Range and `immutable` (WP-17); everywhere else (development, the e2e run, a check of the production build on the
// developer machine) the site serves the same folder itself through /media/* → /api/internal/media/* (see proxy.ts), with the
// same headers. The folder is MEDIA_DIR, by default the prototype folder docs/design/hero-video/media. Without any media the site
// works on its static look.
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, sep } from "node:path";
import { Readable } from "node:stream";

export const DEFAULT_MEDIA_DIR = "docs/design/hero-video/media";
/** The names of the files carry no hash today (the prototype names), so a year is a promise the deploy keeps by renaming. */
export const CACHE_CONTROL = "public, max-age=31536000, immutable";

/**
 * The folder of the media on this machine, or null. A relative MEDIA_DIR is looked for from the working folder up to the
 * root of the disk: the standalone server starts deep inside `.next`, the repository is a few levels above it.
 */
export function resolveMediaRoot(
  env: Readonly<Record<string, string | undefined>>,
  cwd: string,
  exists: (path: string) => boolean,
): string | null {
  const wanted = env.MEDIA_DIR?.trim() ?? "";
  for (const candidate of [wanted, DEFAULT_MEDIA_DIR]) {
    if (candidate === "") continue;
    if (isAbsolute(candidate)) {
      if (exists(join(/* turbopackIgnore: true */ candidate))) return join(/* turbopackIgnore: true */ candidate);
      continue;
    }
    for (let dir = cwd; ; dir = dirname(dir)) {
      const path = join(/* turbopackIgnore: true */ dir, candidate);
      if (exists(path)) return path;
      if (dirname(dir) === dir) break;
    }
  }
  return null;
}

const MEDIA_FILE = /\.(?:mp4|webm|webp|png|jpe?g|avif)$/i;

/** The file for the path segments of the request, or null: no folders above the root, no hidden files, only media types. */
export function resolveMediaFile(root: string, segments: readonly string[]): string | null {
  if (segments.length === 0) return null;
  for (const s of segments) {
    if (s === "" || s === "." || s === ".." || s.startsWith(".")) return null;
    if (/[\\/:\0]/.test(s)) return null;
  }
  const last = segments[segments.length - 1] as string;
  if (!MEDIA_FILE.test(last)) return null;
  return join(/* turbopackIgnore: true */ root, ...segments);
}

const TYPES: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  avif: "image/avif",
};

export function contentTypeOf(file: string): string {
  return TYPES[file.slice(file.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream";
}

export type ByteRange = { kind: "full" } | { kind: "partial"; start: number; end: number } | { kind: "unsatisfiable" };

/** One range of the `Range` header (a video player asks for one); anything else is served whole, as the RFC allows. */
export function parseRange(header: string | null, size: number): ByteRange {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (m[1] === "" && m[2] === "")) return { kind: "full" };
  if (size <= 0) return { kind: "unsatisfiable" };
  if (m[1] === "") {
    const tail = Number(m[2]);
    return tail === 0 ? { kind: "unsatisfiable" } : { kind: "partial", start: Math.max(0, size - tail), end: size - 1 };
  }
  const start = Number(m[1]);
  if (start >= size) return { kind: "unsatisfiable" };
  const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  return end < start ? { kind: "unsatisfiable" } : { kind: "partial", start, end };
}

const notFound = () => new Response(null, { status: 404, headers: { "cache-control": "no-store" } });

/** GET and HEAD of one media file with Range support, the way Caddy would serve it. */
export async function serveMedia(
  request: Request,
  root: string | null,
  segments: readonly string[],
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
  }
  if (root === null) return notFound();
  const file = resolveMediaFile(root, segments);
  if (file === null) return notFound();
  let real: string;
  let size: number;
  try {
    const [rootReal, fileReal] = await Promise.all([
      realpath(/* turbopackIgnore: true */ root),
      realpath(/* turbopackIgnore: true */ file),
    ]);
    if (!fileReal.startsWith(rootReal + sep)) return notFound(); // a link that leads out of the folder
    const info = await stat(/* turbopackIgnore: true */ fileReal);
    if (!info.isFile()) return notFound();
    real = fileReal;
    size = info.size;
  } catch {
    return notFound();
  }
  const range = parseRange(request.headers.get("range"), size);
  const common = {
    "content-type": contentTypeOf(file),
    "accept-ranges": "bytes",
    "cache-control": CACHE_CONTROL,
    "x-content-type-options": "nosniff",
  };
  if (range.kind === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...common, "content-range": `bytes */${size}` } });
  }
  const [start, end, status] = range.kind === "partial" ? [range.start, range.end, 206] : [0, size - 1, 200];
  const headers: Record<string, string> = { ...common, "content-length": String(size === 0 ? 0 : end - start + 1) };
  if (status === 206) headers["content-range"] = `bytes ${start}-${end}/${size}`;
  if (request.method === "HEAD" || size === 0) return new Response(null, { status, headers });
  const body = Readable.toWeb(
    createReadStream(/* turbopackIgnore: true */ real, { start, end }),
  ) as unknown as ReadableStream;
  return new Response(body, { status, headers });
}
