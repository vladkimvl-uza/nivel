import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditSink } from "../../auth/audit.ts";
import type { SessionUser } from "../../auth/service.ts";
import type { AuditEntry } from "../../auth/store.ts";
import { createFsFileSink, type FileRegistry, MAX_UPLOAD_BYTES, saveUpload, UPLOAD_KINDS } from "./save.ts";

const owner: SessionUser = {
  id: "o1",
  email: "o@nivel.uz",
  role: "owner",
  telegramUserId: null,
  sessionExpiresAt: new Date(0),
};
const assistant: SessionUser = { ...owner, id: "a1", role: "assistant" };
const translator: SessionUser = { ...owner, id: "t1", role: "translator" };

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const exif = (secret: string) => {
  const payload = [...ascii("Exif"), 0, 0, ...ascii(secret)];
  return [0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload];
};
const TINY = Buffer.from(
  "/9j/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);
const photo = (secret = "SECRET-GPS") => Buffer.from([0xff, 0xd8, ...exif(secret), ...TINY.subarray(2), 0xff, 0xd9]);

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nivel-upload-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function setup() {
  const rows = new Map<string, { id: string } & Record<string, unknown>>();
  const registry: FileRegistry = {
    async register(f) {
      const existing = rows.get(f.storageKey);
      if (existing) return { id: existing.id, duplicate: true };
      const id = `f${rows.size + 1}`;
      rows.set(f.storageKey, { id, ...f });
      return { id, duplicate: false };
    },
  };
  const audits: AuditEntry[] = [];
  const sink: AuditSink = { append: async (e) => void audits.push(e) };
  return { rows, audits, deps: { files: createFsFileSink(dir), registry, audit: sink } };
}

describe("saveUpload", () => {
  it("strips the location from the photo before anything is stored, and names the file by the hash of what is stored", async () => {
    const { deps, rows } = setup();
    const r = await saveUpload(deps, { actor: owner, bytes: photo(), kind: "receipt" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const saved = await readFile(join(dir, r.storageKey));
    expect(saved.toString("latin1")).not.toContain("SECRET-GPS");
    const sha = createHash("sha256").update(saved).digest("hex");
    expect(r.sha256).toBe(sha);
    expect(r.storageKey).toBe(`uploads/${sha.slice(0, 2)}/${sha}.jpg`);
    expect(r.bytes).toBe(saved.length);
    expect(r.removed).toContain("exif");
    expect(rows.get(r.storageKey)).toMatchObject({
      kind: "receipt",
      mime: "image/jpeg",
      retentionClass: "tax_5y",
      containsPd: true,
      isPublic: false,
      createdBy: "admin:o1",
    });
  });

  it("the same picture twice is one file; the second answer says so", async () => {
    const { deps, rows } = setup();
    const a = await saveUpload(deps, { actor: owner, bytes: photo(), kind: "part_photo" });
    const b = await saveUpload(deps, { actor: owner, bytes: photo("OTHER-EXIF-TEXT"), kind: "part_photo" });
    if (!a.ok || !b.ok) throw new Error("expected success");
    expect(b.storageKey).toBe(a.storageKey);
    expect(b.duplicate).toBe(true);
    expect(rows.size).toBe(1);
    expect((await readdir(join(dir, "uploads"), { recursive: true })).filter((f) => f.endsWith(".jpg"))).toHaveLength(
      1,
    );
  });

  it("journals the upload without the content", async () => {
    const { deps, audits } = setup();
    const r = await saveUpload(deps, { actor: assistant, bytes: photo(), kind: "serial_photo" });
    if (!r.ok) throw new Error(r.error);
    expect(audits).toEqual([
      expect.objectContaining({
        actor: "admin:a1",
        action: "files.upload",
        entity: "ops.files",
        entityId: r.id,
        after: expect.objectContaining({ kind: "serial_photo", sha256: r.sha256, mime: "image/jpeg" }),
      }),
    ]);
  });

  it("the translator may not upload, the assistant and the owner may", async () => {
    const { deps } = setup();
    await expect(saveUpload(deps, { actor: translator, bytes: photo(), kind: "receipt" })).rejects.toThrow(/forbidden/);
    expect((await saveUpload(deps, { actor: assistant, bytes: photo(), kind: "receipt" })).ok).toBe(true);
  });

  it("refuses an unknown kind, an empty file, a big file and something that is not a picture", async () => {
    const { deps, rows } = setup();
    expect(await saveUpload(deps, { actor: owner, bytes: photo(), kind: "passport" })).toEqual({
      ok: false,
      error: "Неизвестный вид файла.",
    });
    expect(await saveUpload(deps, { actor: owner, bytes: Buffer.alloc(0), kind: "receipt" })).toEqual({
      ok: false,
      error: "Файл пуст.",
    });
    expect(
      await saveUpload(deps, { actor: owner, bytes: Buffer.alloc(MAX_UPLOAD_BYTES + 1), kind: "receipt" }),
    ).toEqual({
      ok: false,
      error: "Файл больше 12 МБ.",
    });
    expect(
      await saveUpload(deps, { actor: owner, bytes: Buffer.from("MZ not a picture"), kind: "receipt" }),
    ).toMatchObject({ ok: false });
    expect(rows.size).toBe(0);
  });

  it("knows the kinds and their retention classes", () => {
    expect(UPLOAD_KINDS.receipt?.retentionClass).toBe("tax_5y");
    expect(UPLOAD_KINDS.esf?.retentionClass).toBe("tax_5y");
    expect(UPLOAD_KINDS.part_photo?.containsPd).toBe(false);
  });
});

describe("file sink", () => {
  it("writes under the root, atomically, and does not touch an existing file", async () => {
    const sink = createFsFileSink(dir);
    await sink.put("uploads/ab/abcd.jpg", Buffer.from("one"));
    await sink.put("uploads/ab/abcd.jpg", Buffer.from("two"));
    expect((await readFile(join(dir, "uploads/ab/abcd.jpg"))).toString()).toBe("one");
    expect((await readdir(join(dir, "uploads/ab"))).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect((await stat(join(dir, "uploads/ab/abcd.jpg"))).isFile()).toBe(true);
  });

  it("refuses a key that leaves the root or has odd characters", async () => {
    const sink = createFsFileSink(dir);
    for (const bad of [
      "../escape.jpg",
      "uploads/../../escape.jpg",
      "/abs.jpg",
      "uploads\\win.jpg",
      "uploads/a b.jpg",
      "",
      "uploads//x.jpg",
    ]) {
      await expect(sink.put(bad, Buffer.from("x")), bad).rejects.toThrow(/storage key/);
    }
  });
});
