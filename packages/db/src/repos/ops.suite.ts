import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../client.ts";
import { auditLog } from "../schema/ops.ts";
import { guarded } from "./errors.ts";
import {
  appendAudit,
  claimOutbox,
  consentGranted,
  createAdminSession,
  createAdminUser,
  createDsrRequest,
  deleteAdminSession,
  deleteExpiredAdminSessions,
  enqueueOutbox,
  findAdminByEmail,
  getFile,
  getSetting,
  latestConsent,
  latestThresholdSnapshot,
  listAudit,
  listOpenDsrRequests,
  markOutboxFailed,
  markOutboxSent,
  nextNumber,
  recordAppError,
  recordConsent,
  recordFailedLogin,
  registerFile,
  resetFailedLogins,
  saveThresholdSnapshot,
  setSetting,
  touchAdminSession,
} from "./ops.ts";
import { connectAs, createOrder, openDb, uniq } from "./testkit.ts";

let db: Db;
let order: { orderId: string; customerId: string };

beforeAll(async () => {
  db = openDb("ADMIN");
  const m = await connectAs("MIGRATOR");
  try {
    order = await createOrder(m);
  } finally {
    await m.end();
  }
});
afterAll(async () => {
  await db.$client.end();
});

const sha = () => createHash("sha256").update(String(uniq())).digest("hex");

describe("settings", () => {
  it("returns null for a missing key, then sets, versions and journals changes", async () => {
    expect(await getSetting(db, "ops.test.none")).toBeNull();
    expect(await setSetting(db, "ops.test.rate", { bp: 1500 }, "owner")).toEqual({ version: 1 });
    expect(await setSetting(db, "ops.test.rate", { bp: 1400 }, "owner")).toEqual({ version: 2 });
    expect(await getSetting(db, "ops.test.rate")).toEqual({ value: { bp: 1400 }, version: 2 });
    const audit = await listAudit(db, "ops.settings", "ops.test.rate");
    expect(audit.map((a) => a.after)).toEqual([{ bp: 1400 }, { bp: 1500 }]);
    expect(audit[0]?.before).toEqual({ bp: 1500 });
  });

  it("refuses a change on a stale version", async () => {
    await setSetting(db, "ops.test.stale", 1, "owner");
    await expect(setSetting(db, "ops.test.stale", 2, "owner", { expectedVersion: 5 })).rejects.toMatchObject({
      code: "stale_status",
    });
    await expect(setSetting(db, "ops.test.stale", 2, "owner", { expectedVersion: 1 })).resolves.toEqual({ version: 2 });
    await expect(setSetting(db, "ops.test.fresh", 1, "owner", { expectedVersion: 0 })).resolves.toEqual({ version: 1 });
  });

  it("keeps the setting unchanged when the journal write fails (one transaction)", async () => {
    await setSetting(db, "ops.test.atomic", "a", "owner");
    await expect(
      db.transaction(async (tx) => {
        await setSetting(tx, "ops.test.atomic", "b", "owner");
        throw new Error("rollback please");
      }),
    ).rejects.toThrow("rollback please");
    expect((await getSetting(db, "ops.test.atomic"))?.value).toBe("a");
  });
});

describe("audit log", () => {
  it("appends and lists newest first; a journal row cannot be changed", async () => {
    await appendAudit(db, {
      actor: "owner:1",
      action: "x.a",
      entity: "demo",
      entityId: "e1",
      after: { n: 1 },
    });
    await appendAudit(db, { actor: "owner:1", action: "x.b", entity: "demo", entityId: "e1" });
    const rows = await listAudit(db, "demo", "e1");
    expect(rows.map((r) => r.action)).toEqual(["x.b", "x.a"]);
    await expect(
      guarded(() => db.update(auditLog).set({ action: "z" }).where(eq(auditLog.id, rows[0]?.id ?? ""))),
    ).rejects.toMatchObject({
      code: "permission_denied",
    });
  });
});

describe("outbox", () => {
  it("ignores a second write with the same dedupe key and tells the caller", async () => {
    const key = `order-1:accepted:${uniq()}`;
    const first = await enqueueOutbox(db, { kind: "telegram_message", payload: { text: "a" }, dedupeKey: key });
    const second = await enqueueOutbox(db, { kind: "telegram_message", payload: { text: "a" }, dedupeKey: key });
    expect(first.duplicate).toBe(false);
    expect(second).toEqual({ id: first.id, duplicate: true });
  });

  it("allows many rows without a key", async () => {
    const a = await enqueueOutbox(db, { kind: "job", payload: { name: "x" } });
    const b = await enqueueOutbox(db, { kind: "job", payload: { name: "x" } });
    expect(a.id).not.toBe(b.id);
  });

  it("hands out due rows by priority, skips what is locked, and finishes or retries them", async () => {
    await db.$client.query("delete from ops.outbox");
    const low = await enqueueOutbox(db, { kind: "telegram_message", payload: { n: 1 }, priority: 0 });
    const high = await enqueueOutbox(db, { kind: "telegram_message", payload: { n: 2 }, priority: 5 });
    const later = await enqueueOutbox(db, {
      kind: "telegram_message",
      payload: { n: 3 },
      sendAfter: new Date(Date.now() + 3_600_000),
    });
    const claimed = await db.transaction(async (tx) => {
      const batch = await claimOutbox(tx, 10);
      // A second relay on another connection sees nothing of the locked rows (SKIP LOCKED).
      const other = await db.transaction((tx2) => claimOutbox(tx2, 10));
      return { batch, other };
    });
    expect(claimed.batch.map((r) => r.id)).toEqual([high.id, low.id]);
    expect(claimed.other).toEqual([]);
    expect(claimed.batch.some((r) => r.id === later.id)).toBe(false);

    await markOutboxSent(db, high.id);
    expect(await markOutboxFailed(db, low.id, "429", { maxAttempts: 2, retryAfterMs: 1000 })).toBe("pending");
    expect(await markOutboxFailed(db, low.id, "429", { maxAttempts: 2, retryAfterMs: 1000 })).toBe("failed");
    const left = await db.transaction((tx2) => claimOutbox(tx2, 10, new Date(Date.now() + 7_200_000)));
    expect(left.map((r) => r.id)).toEqual([later.id]);
    await expect(markOutboxFailed(db, "00000000-0000-7000-8000-000000000000", "x")).rejects.toThrow(/not found/);
  });
});

describe("consents", () => {
  it("answers by the newest row of the kind for the order", async () => {
    expect(await latestConsent(db, order.orderId, "non_returnable")).toBeNull();
    expect(await consentGranted(db, order.orderId, "non_returnable")).toBe(false);
    await recordConsent(db, {
      customerId: order.customerId,
      orderId: order.orderId,
      kind: "non_returnable",
      granted: true,
      at: new Date("2026-10-01T10:00:00Z"),
    });
    expect(await consentGranted(db, order.orderId, "non_returnable")).toBe(true);
    await recordConsent(db, {
      customerId: order.customerId,
      orderId: order.orderId,
      kind: "non_returnable",
      granted: false,
      at: new Date("2026-10-02T10:00:00Z"),
    });
    expect(await consentGranted(db, order.orderId, "non_returnable")).toBe(false);
    expect((await latestConsent(db, order.orderId, "non_returnable"))?.granted).toBe(false);
  });
});

describe("files and numbers", () => {
  it("registers a file and reads it back", async () => {
    const id = await registerFile(db, {
      sha256: sha(),
      mime: "image/jpeg",
      bytes: 1234,
      storageKey: `receipts/${uniq()}.jpg`,
      kind: "receipt",
      retentionClass: "tax_5y",
      containsPd: false,
    });
    expect((await getFile(db, id))?.mime).toBe("image/jpeg");
    expect(await getFile(db, "00000000-0000-7000-8000-000000000000")).toBeNull();
  });

  it("issues gap-free public numbers per kind and year", async () => {
    expect(await nextNumber(db, "L", 2041)).toBe("L-2041-0001");
    expect(await nextNumber(db, "L", 2041)).toBe("L-2041-0002");
    expect(await nextNumber(db, "NV", 2041)).toBe("NV-2041-0001");
    expect(await nextNumber(db, "G", 2041)).toBe("G-2041-0001");
  });
});

describe("errors, thresholds, data subject requests", () => {
  it("counts a repeated error instead of storing it twice", async () => {
    const fp = `fp-${uniq()}`;
    expect(await recordAppError(db, { app: "worker", fingerprint: fp, message: "boom" })).toEqual({ count: 1 });
    expect(await recordAppError(db, { app: "worker", fingerprint: fp, message: "boom" })).toEqual({ count: 2 });
    expect(await recordAppError(db, { app: "web", fingerprint: fp, message: "boom" })).toEqual({ count: 1 });
  });

  it("keeps one threshold snapshot per year and day, the newest on top", async () => {
    await saveThresholdSnapshot(db, {
      year: 2042,
      asOf: "2042-03-01",
      dealsSum: 100,
      committedSum: 50,
      limitSum: 1_000,
      shareBp: 1000,
    });
    await saveThresholdSnapshot(db, {
      year: 2042,
      asOf: "2042-03-01",
      dealsSum: 200,
      committedSum: 50,
      limitSum: 1_000,
      shareBp: 2000,
    });
    await saveThresholdSnapshot(db, {
      year: 2042,
      asOf: "2042-02-01",
      dealsSum: 10,
      committedSum: 0,
      limitSum: 1_000,
      shareBp: 100,
    });
    expect(await latestThresholdSnapshot(db, 2042)).toMatchObject({ asOf: "2042-03-01", dealsSum: 200, shareBp: 2000 });
    expect(await latestThresholdSnapshot(db, 2099)).toBeNull();
  });

  it("registers a data subject request due in 30 days and lists open ones", async () => {
    const r = await createDsrRequest(db, order.customerId, "erase");
    expect(r.status).toBe("open");
    const days = (r.due.getTime() - r.receivedAt.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(30);
    expect((await listOpenDsrRequests(db)).some((x) => x.id === r.id)).toBe(true);
  });
});

describe("admin accounts and sessions", () => {
  it("finds an account regardless of the e-mail case and locks it after repeated failures", async () => {
    const email = `Owner${uniq()}@Example.test`;
    const id = await createAdminUser(db, { email, passwordHash: "argon2id$x", role: "owner" });
    expect((await findAdminByEmail(db, email.toLowerCase()))?.id).toBe(id);
    expect(await findAdminByEmail(db, "nobody@example.test")).toBeNull();
    const now = new Date("2026-10-06T10:00:00Z");
    expect(await recordFailedLogin(db, id, { lockAfter: 3, lockMinutes: 15, now })).toMatchObject({
      failedLogins: 1,
      lockedUntil: null,
    });
    await recordFailedLogin(db, id, { lockAfter: 3, lockMinutes: 15, now });
    const third = await recordFailedLogin(db, id, { lockAfter: 3, lockMinutes: 15, now });
    expect(third.failedLogins).toBe(3);
    expect(third.lockedUntil?.toISOString()).toBe("2026-10-06T10:15:00.000Z");
    await resetFailedLogins(db, id);
    expect((await findAdminByEmail(db, email))?.failedLogins).toBe(0);
    await expect(
      recordFailedLogin(db, "00000000-0000-7000-8000-000000000000", { lockAfter: 3, lockMinutes: 1 }),
    ).rejects.toThrow(/not found/);
  });

  it("opens, touches, expires and deletes sessions", async () => {
    const userId = await createAdminUser(db, {
      email: `s${uniq()}@example.test`,
      passwordHash: "x",
      role: "assistant",
    });
    const live = sha();
    const stale = sha();
    await createAdminSession(db, {
      tokenSha256: live,
      userId,
      expiresAt: new Date(Date.now() + 3_600_000),
      ipHash: "h",
      ua: "test",
    });
    await createAdminSession(db, { tokenSha256: stale, userId, expiresAt: new Date(Date.now() - 1000) });
    expect(await touchAdminSession(db, live)).toMatchObject({ tokenSha256: live, userId });
    expect(await touchAdminSession(db, stale)).toBeNull();
    expect(await deleteExpiredAdminSessions(db)).toBeGreaterThanOrEqual(1);
    await deleteAdminSession(db, live);
    expect(await touchAdminSession(db, live)).toBeNull();
  });
});
