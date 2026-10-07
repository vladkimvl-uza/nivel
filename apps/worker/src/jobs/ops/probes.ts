// What ops.selfcheck looks at outside the database (ARCHITECTURE 9): the age of the last backup, the disk, the certificate.
// The backups are not made by the worker but by the container `backup` (12.4: the worker holds no keys of the backups); it leaves
// a mark file after a good copy, and the worker reads its age. A probe the runtime cannot answer is `null`: the check then says
// that it cannot tell, instead of raising an alarm for nothing.
import { stat, statfs } from "node:fs/promises";
import { connect } from "node:tls";
import type { Probes } from "../../queues/runtime.ts";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Age of a file in hours; infinite when the file is not there; never negative. */
export async function fileAgeHours(path: string, now: Date): Promise<number> {
  try {
    const info = await stat(path);
    return Math.max(0, (now.getTime() - info.mtimeMs) / HOUR_MS);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return Number.POSITIVE_INFINITY;
    throw error;
  }
}

/** Percent of the disk under `path` that is in use, or null when the path cannot be looked at. */
export async function diskUsedPercent(path: string): Promise<number | null> {
  try {
    const s = await statfs(path);
    if (s.blocks === 0) return null;
    return ((s.blocks - s.bfree) / s.blocks) * 100;
  } catch {
    return null;
  }
}

/** Whole days between `now` and the end date of a certificate as OpenSSL writes it ("Oct 26 10:00:00 2026 GMT"). */
export function daysUntil(validTo: string, now: Date): number | null {
  const end = Date.parse(validTo);
  if (Number.isNaN(end)) return null;
  return Math.floor((end - now.getTime()) / DAY_MS);
}

async function certificateValidTo(host: string, port: number): Promise<string | null> {
  return new Promise((resolve) => {
    // The certificate is only read: whether it is trusted is not this check's business, and an expired one must still be seen.
    const socket = connect({ host, port, servername: host, rejectUnauthorized: false }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      resolve(cert?.valid_to ?? null);
    });
    socket.setTimeout(8000, () => {
      socket.destroy();
      resolve(null);
    });
    socket.on("error", () => resolve(null));
  });
}

export interface ProbeSources {
  now(): Date;
  /** PUBLIC_BASE_URL: the certificate is the one of its host, and only for https. */
  publicBaseUrl: string;
  /** The directory the data lies on (FILES_DIR). */
  dataDir: string | undefined;
  /** The mark file of the backup container (BACKUP_MARK_FILE). */
  backupMarkFile: string | undefined;
}

export function createProbes(s: ProbeSources): Probes {
  return {
    async backupAgeHours() {
      return s.backupMarkFile === undefined ? null : fileAgeHours(s.backupMarkFile, s.now());
    },
    async diskUsedPercent() {
      return s.dataDir === undefined ? null : diskUsedPercent(s.dataDir);
    },
    async certDaysLeft() {
      let url: URL;
      try {
        url = new URL(s.publicBaseUrl);
      } catch {
        return null;
      }
      if (url.protocol !== "https:") return null;
      const validTo = await certificateValidTo(url.hostname, url.port === "" ? 443 : Number(url.port));
      return validTo === null ? null : daysUntil(validTo, s.now());
    },
  };
}
