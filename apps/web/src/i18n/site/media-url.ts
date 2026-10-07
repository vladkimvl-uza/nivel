// Addresses of the media (videos and posters of the first screen and of the background). No file system here: the page, the proxy
// and the scripts of the browser take addresses from this file; the folder of the files and the serving are in media.ts.

export const DEFAULT_MEDIA_BASE = "/media";
/** Where the page asks for the media: `MEDIA_BASE_URL` (a path or an https address) or `/media`. */
export function mediaBaseOf(env: Readonly<Record<string, string | undefined>>): string {
  const raw = env.MEDIA_BASE_URL?.trim().replace(/\/+$/, "") ?? "";
  return /^(?:\/(?!\/)[A-Za-z0-9._~/-]*|https?:\/\/[^\s]+)$/.test(raw) && raw !== "" ? raw : DEFAULT_MEDIA_BASE;
}

export function mediaUrl(base: string, relative: string): string {
  return `${base.replace(/\/+$/, "")}/${relative.replace(/^\/+/, "")}`;
}

/** `/media/bg/x.mp4` becomes `/api/internal/media/bg/x.mp4`: where proxy.ts sends a media request that Caddy did not take. */
export function internalMediaPath(pathname: string): string | null {
  return pathname.startsWith("/media/") && pathname.length > "/media/".length
    ? `/api/internal/media${pathname.slice("/media".length)}`
    : null;
}
