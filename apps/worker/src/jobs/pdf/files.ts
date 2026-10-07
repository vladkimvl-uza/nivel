// Where the bytes of a document lie and how the database knows them: the file goes under FILES_DIR (a relative key of plain names,
// as ops.files demands), its row goes into ops.files, and the ids of the two languages go into the row of the document
// (sales.quotes, commission_reports, acts, build_passports: `pdf_uz_file_id`, `pdf_ru_file_id`, written once).
import { createHash } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import type { Db } from "@nivel/db";
import type { LinkTarget } from "./build.ts";

const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const MAX_KEY = 300;

/** ops.files.storage_key: a relative path of plain names; the database holds the same rule (files_storage_key_chk). */
export function assertStorageKey(key: string): void {
  const parts = key.split("/");
  if (
    key === "" ||
    key.length > MAX_KEY ||
    isAbsolute(key) ||
    !parts.every((p) => SEGMENT.test(p) && p !== "." && p !== "..")
  ) {
    throw new Error(`storage key ${JSON.stringify(key)} is not a relative path of plain names`);
  }
}

/** The folder of an order and the name of a file: `documents/NV-2026-0001/quote-2-uz.pdf`. */
export const storageKeyOf = (orderNumber: string, base: string, lang: "uz" | "ru"): string =>
  `documents/${orderNumber}/${base}-${lang}.pdf`;

export interface NewFile {
  sha256: string;
  bytes: number;
  storageKey: string;
  kind: string;
  retentionClass: "tax_5y" | "order_warranty_plus_3y";
}

export type LinkResult = "linked" | "already" | "no_privilege";

export interface DocFiles {
  /** The id of the file registered under the key, or null. */
  find(storageKey: string): Promise<string | null>;
  /** Writes the bytes under the key, whole or not at all. */
  save(storageKey: string, bytes: Buffer): Promise<void>;
  /** Registers the file; a second registration under the same key answers the id that is there. */
  register(file: NewFile): Promise<string>;
  link(target: LinkTarget, ids: { uz: string; ru: string }): Promise<LinkResult>;
}

export const sha256Of = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

/** The disk under FILES_DIR: a temporary name first, then the rename, so a reader never sees half a document. */
export function createFsWriter(root: string): Pick<DocFiles, "save"> {
  const base = resolve(root);
  return {
    async save(storageKey, bytes) {
      assertStorageKey(storageKey);
      const target = resolve(join(base, normalize(storageKey)));
      if (!target.startsWith(base + sep)) throw new Error("storage key leaves the files directory");
      await mkdir(dirname(target), { recursive: true });
      const temp = `${target}.${process.pid}.tmp`;
      try {
        await writeFile(temp, bytes);
        await rename(temp, target);
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
    },
  };
}

const INSUFFICIENT_PRIVILEGE = "42501";

export function createPgDocFiles(db: Db, writer: Pick<DocFiles, "save">): DocFiles {
  const q = db.$client;
  const find = async (key: string): Promise<string | null> => {
    const { rows } = await q.query<{ id: string }>("select id from ops.files where storage_key = $1", [key]);
    return rows[0]?.id ?? null;
  };
  return {
    find,
    save: writer.save,
    async register(f) {
      assertStorageKey(f.storageKey);
      const { rows } = await q.query<{ id: string }>(
        `insert into ops.files (sha256, mime, bytes, storage_key, kind, is_public, contains_pd, retention_class, created_by)
         values ($1, 'application/pdf', $2, $3, $4, false, true, $5, 'worker:pdf.render')
         on conflict (storage_key) do nothing returning id`,
        [f.sha256, f.bytes, f.storageKey, f.kind, f.retentionClass],
      );
      const id = rows[0]?.id ?? (await find(f.storageKey));
      if (id === null) throw new Error(`the file ${f.storageKey} was not registered`);
      return id;
    },
    async link(target, ids) {
      try {
        // The names come from the closed list of LinkTarget; the links are written once: what is there stays.
        const { rowCount } = await q.query(
          `update sales.${target.table}
              set pdf_uz_file_id = coalesce(pdf_uz_file_id, $1), pdf_ru_file_id = coalesce(pdf_ru_file_id, $2)
            where ${target.keyColumn} = $3 and (pdf_uz_file_id is null or pdf_ru_file_id is null)`,
          [ids.uz, ids.ru, target.key],
        );
        return rowCount === 0 ? "already" : "linked";
      } catch (error) {
        if ((error as { code?: string }).code === INSUFFICIENT_PRIVILEGE) return "no_privilege";
        throw error;
      }
    },
  };
}
