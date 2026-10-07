import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditSink } from "../../auth/audit.ts";
import type { SessionUser } from "../../auth/service.ts";
import type { AuditEntry } from "../../auth/store.ts";
import {
  createFsFileSink,
  type FileRegistry,
  MAX_PARALLEL_CLEANINGS,
  MAX_UPLOAD_BYTES,
  MAX_WAITING_CLEANINGS,
  saveUpload,
  takeUploadSlot,
  UPLOAD_KINDS,
} from "./save.ts";

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

describe("saveUpload: names of Object.prototype are not kinds of file", () => {
  it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])(
    "refuses kind %s before anything is stored",
    async (kind) => {
      const { deps, rows } = setup();
      const r = await saveUpload(deps, { actor: owner, bytes: photo(), kind });
      expect(r).toEqual({ ok: false, error: "Неизвестный вид файла." });
      expect(rows.size).toBe(0);
      expect(await readdir(dir)).toEqual([]);
    },
  );
});

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

describe("saveUpload: the work on a picture is limited, so that a flood of big files cannot starve the admin", () => {
  it("runs at most two cleanings at once, queues a few more and turns the rest away", async () => {
    const { deps } = setup();
    let active = 0;
    let peak = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fallback = async (input: Buffer) => {
      active += 1;
      peak = Math.max(peak, active);
      await gate;
      active -= 1;
      return { ok: true as const, data: Buffer.from(input), mime: "image/jpeg", ext: "jpg", removed: [] };
    };
    const heic = (n: number) =>
      Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.from([n])]);
    const all = Array.from({ length: 12 }, (_, i) =>
      saveUpload({ ...deps, fallback }, { actor: assistant, bytes: heic(i), kind: "receipt" }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(active).toBe(MAX_PARALLEL_CLEANINGS);
    release();
    const results = await Promise.all(all);
    expect(peak).toBe(MAX_PARALLEL_CLEANINGS);
    const busy = results.filter((r) => !r.ok && r.error.includes("занят"));
    expect(busy).toHaveLength(12 - MAX_PARALLEL_CLEANINGS - MAX_WAITING_CLEANINGS);
    expect(results.filter((r) => r.ok)).toHaveLength(MAX_PARALLEL_CLEANINGS + MAX_WAITING_CLEANINGS);
  });

  it("lets the next one in after an earlier one failed", async () => {
    const { deps } = setup();
    const boom = async () => {
      throw new Error("sharp fell over");
    };
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic")]);
    for (let i = 0; i < 5; i += 1) {
      await expect(
        saveUpload({ ...deps, fallback: boom }, { actor: assistant, bytes: heic, kind: "receipt" }),
      ).rejects.toThrow("sharp fell over");
    }
    const ok = await saveUpload(deps, { actor: assistant, bytes: photo(), kind: "receipt" });
    expect(ok.ok).toBe(true);
  });
});

describe("the queue for a place: whoever waits can leave, and does not wait for ever", () => {
  const fill = async () => {
    const held = [];
    for (let i = 0; i < MAX_PARALLEL_CLEANINGS; i += 1) {
      const slot = await takeUploadSlot();
      if (!slot) throw new Error("expected a place");
      held.push(slot);
    }
    return held;
  };

  it("takes a waiter out of the queue when the request is cancelled, so that its place is free for the next", async () => {
    const held = await fill();
    const leave = new AbortController();
    const first = takeUploadSlot({ signal: leave.signal });
    const others = Array.from({ length: MAX_WAITING_CLEANINGS - 1 }, () => takeUploadSlot());
    // The queue is full now.
    expect(await takeUploadSlot()).toBeNull();
    leave.abort();
    expect(await first).toBeNull();
    // The seat of the one that left is free: a new waiter is queued, not turned away.
    const next = takeUploadSlot();
    for (const slot of held) slot.release();
    for (const waiter of [...others, next]) {
      const got = await waiter;
      expect(got).not.toBeNull();
      got?.release();
    }
  });

  it("a waiter that was cancelled before it asked gets nothing and takes nothing", async () => {
    const held = await fill();
    const gone = AbortSignal.abort();
    expect(await takeUploadSlot({ signal: gone })).toBeNull();
    for (const slot of held) slot.release();
    const again = await takeUploadSlot();
    expect(again).not.toBeNull();
    again?.release();
  });

  it("turns away a waiter that has waited too long, and the places still go round", async () => {
    const held = await fill();
    expect(await takeUploadSlot({ maxWaitMs: 30 })).toBeNull();
    const next = takeUploadSlot();
    held[0]?.release();
    const got = await next;
    expect(got).not.toBeNull();
    got?.release();
    held[1]?.release();
  });
});
