import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertStorageKey, createFsWriter, sha256Of, storageKeyOf } from "./files.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nivel-pdf-files-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("the key of a stored document", () => {
  it("is the folder of the order and the name of the document with the language", () => {
    expect(storageKeyOf("NV-2026-0001", "quote-2", "uz")).toBe("documents/NV-2026-0001/quote-2-uz.pdf");
    expect(storageKeyOf("NV-2026-0001", "act-handover-0199ab12", "ru")).toBe(
      "documents/NV-2026-0001/act-handover-0199ab12-ru.pdf",
    );
    for (const key of [
      storageKeyOf("NV-2026-0001", "quote-2", "uz"),
      storageKeyOf("NV-2026-12345", "report-10", "ru"),
      storageKeyOf("NV-2026-0001", "passport", "uz"),
    ]) {
      expect(() => assertStorageKey(key)).not.toThrow();
    }
  });

  it("refuses what could leave the folder or is not plain: absolute, dotted, empty or backslashed segments, too long", () => {
    for (const key of [
      "",
      "/etc/passwd",
      "../x.pdf",
      "documents/../x.pdf",
      "documents//x.pdf",
      ".hidden/x.pdf",
      "documents/.x.pdf",
      "documents\\x.pdf",
      "documents/a b.pdf",
      "documents/é.pdf",
      `documents/${"a".repeat(300)}.pdf`,
      "C:/x.pdf",
    ]) {
      expect(() => assertStorageKey(key), key).toThrow(/storage key/);
    }
  });
});

describe("the writer of the disk", () => {
  it("writes the bytes under the key, making the folders, and leaves no temporary file", async () => {
    const bytes = Buffer.from("%PDF-1.3 test");
    await createFsWriter(dir).save("documents/NV-2026-0001/quote-1-uz.pdf", bytes);
    expect(await readFile(join(dir, "documents", "NV-2026-0001", "quote-1-uz.pdf"))).toEqual(bytes);
    expect(await readdir(join(dir, "documents", "NV-2026-0001"))).toEqual(["quote-1-uz.pdf"]);
  });

  it("replaces a file that is there whole, and takes a key that leaves the folder for an error", async () => {
    const w = createFsWriter(dir);
    await w.save("documents/a/x.pdf", Buffer.from("one"));
    await w.save("documents/a/x.pdf", Buffer.from("two"));
    expect((await readFile(join(dir, "documents", "a", "x.pdf"))).toString()).toBe("two");
    await expect(w.save("../escape.pdf", Buffer.from("x"))).rejects.toThrow(/storage key/);
    await expect(w.save("/abs.pdf", Buffer.from("x"))).rejects.toThrow(/storage key/);
  });

  it("cleans up after a write that failed: a folder in the way of the file", async () => {
    const w = createFsWriter(dir);
    await w.save("documents/a/x.pdf/inner.pdf", Buffer.from("x"));
    await expect(w.save("documents/a/x.pdf", Buffer.from("y"))).rejects.toThrow();
    expect((await readdir(join(dir, "documents", "a"))).filter((n) => n.endsWith(".tmp"))).toEqual([]);
  });
});

describe("the hash of a document", () => {
  it("is the SHA-256 in hex, 64 characters, as ops.files wants it", () => {
    expect(sha256Of(Buffer.from("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
