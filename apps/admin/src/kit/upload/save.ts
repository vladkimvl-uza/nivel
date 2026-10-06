// A file from the phone (receipt, electronic invoice, photo of a part or of a serial number): cleaned of EXIF, stored
// under the hash of its content, registered in ops.files, journaled. The caller (a screen of this or of another work
// package) sees one function.
import { createHash, randomBytes } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { AuditSink } from "../../auth/audit.ts";
import { requirePermission } from "../../auth/roles.ts";
import type { SessionUser } from "../../auth/service.ts";
import { type FallbackSanitizer, sanitizeImage } from "./image.ts";

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/**
 * Cleaning a picture holds the whole file and a working copy in memory (and sharp, more), and the admin container has
 * 384 MB. Two cleanings run at once, a few wait, and the rest are turned away with a plain message.
 */
export const MAX_PARALLEL_CLEANINGS = 2;
export const MAX_WAITING_CLEANINGS = 8;
const BUSY = "Сервер занят обработкой других снимков. Повторите через минуту.";

const cleaning = { active: 0, waiting: [] as Array<() => void> };

/** The slot is taken, or null when the queue is full. The function that gives the slot back is returned. */
async function takeCleaningSlot(): Promise<(() => void) | null> {
  if (cleaning.active >= MAX_PARALLEL_CLEANINGS) {
    if (cleaning.waiting.length >= MAX_WAITING_CLEANINGS) return null;
    await new Promise<void>((resolve) => cleaning.waiting.push(resolve));
  } else {
    cleaning.active += 1;
  }
  return () => {
    // The slot goes straight to the next in the queue (the count of the active stays), or is freed.
    const next = cleaning.waiting.shift();
    if (next) next();
    else cleaning.active -= 1;
  };
}

type RetentionClass = "lead_12m" | "order_warranty_plus_3y" | "tax_5y" | "ai_90d" | "media";

/** What a file is for decides how long it is kept (ARCHITECTURE 10.2) and whether it may show a person's data. */
export const UPLOAD_KINDS: Record<string, { label: string; retentionClass: RetentionClass; containsPd: boolean }> = {
  receipt: { label: "Чек", retentionClass: "tax_5y", containsPd: true },
  esf: { label: "Электронная счёт-фактура", retentionClass: "tax_5y", containsPd: true },
  part_photo: { label: "Фото детали", retentionClass: "order_warranty_plus_3y", containsPd: false },
  serial_photo: { label: "Фото серийного номера", retentionClass: "order_warranty_plus_3y", containsPd: false },
};

export interface FileSink {
  /** Stores bytes under a key; an existing key is left as it is (the key is the hash of the content). */
  put(key: string, data: Buffer): Promise<void>;
}

const KEY_RE = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/;

export function createFsFileSink(root: string): FileSink {
  const base = resolve(root);
  return {
    async put(key, data) {
      if (!KEY_RE.test(key) || key.includes("..")) throw new Error(`bad storage key: ${JSON.stringify(key)}`);
      const target = resolve(join(base, key));
      if (!target.startsWith(base + sep)) throw new Error(`bad storage key: ${JSON.stringify(key)}`);
      try {
        if ((await stat(target)).isFile()) return;
      } catch {
        // not there yet
      }
      await mkdir(dirname(target), { recursive: true });
      const temp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
      try {
        await writeFile(temp, data, { flag: "wx" });
        await rename(temp, target);
      } finally {
        await rm(temp, { force: true });
      }
    },
  };
}

export interface RegisteredFile {
  sha256: string;
  mime: string;
  bytes: number;
  storageKey: string;
  kind: string;
  isPublic: false;
  containsPd: boolean;
  retentionClass: RetentionClass;
  createdBy: string;
}

export interface FileRegistry {
  /** Writes the row of ops.files; for a key that is already there answers with the existing row. */
  register(file: RegisteredFile): Promise<{ id: string; duplicate: boolean }>;
}

export interface UploadDeps {
  files: FileSink;
  registry: FileRegistry;
  audit: AuditSink;
  /** sharp: reads what the plain cleaner does not (HEIF/AVIF) and re-encodes it without metadata. */
  fallback?: FallbackSanitizer;
}

export type UploadResult =
  | {
      ok: true;
      id: string;
      storageKey: string;
      sha256: string;
      bytes: number;
      mime: string;
      removed: string[];
      duplicate: boolean;
    }
  | { ok: false; error: string };

export async function saveUpload(
  deps: UploadDeps,
  input: { actor: SessionUser; bytes: Buffer; kind: string },
): Promise<UploadResult> {
  requirePermission(input.actor, "upload.write");
  const kind = Object.hasOwn(UPLOAD_KINDS, input.kind) ? UPLOAD_KINDS[input.kind] : undefined;
  if (!kind) return { ok: false, error: "Неизвестный вид файла." };
  if (input.bytes.length > MAX_UPLOAD_BYTES) return { ok: false, error: "Файл больше 12 МБ." };

  const release = await takeCleaningSlot();
  if (!release) return { ok: false, error: BUSY };
  let clean: Awaited<ReturnType<typeof sanitizeImage>>;
  try {
    clean = await sanitizeImage(input.bytes, deps.fallback ? { fallback: deps.fallback } : {});
  } finally {
    release();
  }
  if (!clean.ok) return clean;

  const sha256 = createHash("sha256").update(clean.data).digest("hex");
  const storageKey = `uploads/${sha256.slice(0, 2)}/${sha256}.${clean.ext}`;
  await deps.files.put(storageKey, clean.data);
  const row = await deps.registry.register({
    sha256,
    mime: clean.mime,
    bytes: clean.data.length,
    storageKey,
    kind: input.kind,
    isPublic: false,
    containsPd: kind.containsPd,
    retentionClass: kind.retentionClass,
    createdBy: `admin:${input.actor.id}`,
  });
  await deps.audit.append({
    actor: `admin:${input.actor.id}`,
    action: "files.upload",
    entity: "ops.files",
    entityId: row.id,
    after: {
      kind: input.kind,
      sha256,
      bytes: clean.data.length,
      mime: clean.mime,
      removed: clean.removed,
      duplicate: row.duplicate,
    },
  });
  return {
    ok: true,
    id: row.id,
    storageKey,
    sha256,
    bytes: clean.data.length,
    mime: clean.mime,
    removed: clean.removed,
    duplicate: row.duplicate,
  };
}
