import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileStore, disabledFileStore } from "./files.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nivel-files-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("createFileStore.remove", () => {
  it("removes the bytes of a file by its storage key", async () => {
    mkdirSync(join(dir, "orders", "2026"), { recursive: true });
    writeFileSync(join(dir, "orders", "2026", "receipt.jpg"), "x");
    const store = createFileStore(dir);
    await store.remove("orders/2026/receipt.jpg");
    expect(existsSync(join(dir, "orders", "2026", "receipt.jpg"))).toBe(false);
  });

  it("takes a file that is already gone as removed (a retry after a crash finds the same keys)", async () => {
    const store = createFileStore(dir);
    await expect(store.remove("orders/none.jpg")).resolves.toBeUndefined();
    await expect(store.remove("none-at-all/deep/er.jpg")).resolves.toBeUndefined();
  });

  it("refuses a key that would climb out of the directory, and removes nothing", async () => {
    const outside = join(dir, "..", `outside-${Date.now()}.txt`);
    writeFileSync(outside, "keep");
    try {
      const store = createFileStore(dir);
      for (const key of [
        "../outside.txt",
        `../${outside}`,
        "a/../../x",
        "/etc/passwd",
        "C:\\Windows\\x",
        "a\\..\\b",
        "",
        " ",
        "a/./b",
        "a//b",
      ]) {
        await expect(store.remove(key), key).rejects.toThrow(/storage key/);
      }
      expect(existsSync(outside)).toBe(true);
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it("does not follow a directory in place of a file: a key names a file", async () => {
    mkdirSync(join(dir, "folder"));
    writeFileSync(join(dir, "folder", "inside.txt"), "x");
    const store = createFileStore(dir);
    await expect(store.remove("folder")).rejects.toThrow();
    expect(existsSync(join(dir, "folder", "inside.txt"))).toBe(true);
  });
});

describe("disabledFileStore (no FILES_DIR)", () => {
  it("removes nothing and says why: the retention of files must not run without a place for the bytes", async () => {
    await expect(disabledFileStore.remove("a/b")).rejects.toThrow(/FILES_DIR/);
  });
});
