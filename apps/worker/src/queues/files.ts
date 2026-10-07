// The bytes of the files on the disk (FILES_DIR). The worker removes them for the retention of files (DATA-MAP 9): the database
// gives the storage keys of the rows it has deleted, and the worker removes the bytes before the transaction commits.
// A key is a relative path (files_storage_key_chk makes sure of it in the database); this is the second line: the path is
// checked again and must stay inside the directory.
import { rm, stat } from "node:fs/promises";
import { isAbsolute, join, normalize, resolve, sep } from "node:path";
import type { FileStore } from "./runtime.ts";

const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

export function createFileStore(root: string): FileStore {
  const base = resolve(root);
  return {
    async remove(storageKey) {
      const parts = storageKey.split("/");
      if (
        storageKey === "" ||
        isAbsolute(storageKey) ||
        !parts.every((p) => SEGMENT.test(p) && p !== "." && p !== "..")
      ) {
        throw new Error("storage key is not a relative path of plain names");
      }
      const target = resolve(join(base, normalize(storageKey)));
      if (!target.startsWith(base + sep)) throw new Error("storage key leaves the files directory");
      const info = await stat(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
        throw error;
      });
      if (info === null) return; // already gone: removed
      if (!info.isFile()) throw new Error("storage key names something that is not a file");
      await rm(target, { force: true });
    },
  };
}

/** Without FILES_DIR the worker has nowhere to remove bytes from, so the retention of files does not run at all. */
export const disabledFileStore: FileStore = {
  async remove() {
    throw new Error("FILES_DIR is not set: the bytes of files cannot be removed");
  },
};
