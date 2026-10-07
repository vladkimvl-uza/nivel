// The routes of the orders screens that are not pages: the file of an order, the upload of an act photo, the CSV of the
// registry. The session, the database and the folder of files are replaced; the rest is the real code.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "../auth/service.ts";
import { heicPhoto, phonePhoto } from "./e2e/photo.ts";

const state = vi.hoisted(() => ({
  user: null as SessionUser | null,
  rows: [] as Record<string, unknown>[],
  filesDir: "",
  registered: [] as Record<string, unknown>[],
  stored: [] as string[],
  audit: [] as Record<string, unknown>[],
  guardAllowed: true,
  registryRows: [] as unknown[],
  incomeRows: [] as unknown[],
}));

vi.mock("../auth/next.ts", () => ({
  currentUser: async () => state.user,
  requestInfo: async () => ({ ipHash: "h", ua: null }),
  guardAction: async () => (state.guardAllowed ? state.user : null),
  NOT_ALLOWED: "Недостаточно прав для этого действия.",
}));
vi.mock("../auth/runtime.ts", () => ({
  getRuntime: () => ({
    env: { FILES_DIR: state.filesDir },
    db: { $client: { query: async () => ({ rows: state.rows }) } },
    audit: {
      append: async (entry: Record<string, unknown>) => {
        state.audit.push(entry);
      },
    },
    upload: {
      files: {
        put: async (key: string) => {
          state.stored.push(key);
        },
      },
      registry: {
        register: async (file: Record<string, unknown>) => {
          state.registered.push(file);
          return { id: "0199aaaa-bbbb-7ccc-8ddd-0000000000f1", duplicate: state.registered.length > 1 };
        },
      },
    },
  }),
}));
vi.mock("./runtime.ts", () => ({ servicesRuntime: () => ({ now: () => new Date("2026-10-12T05:00:00Z") }) }));
vi.mock("./read-registry.ts", async (importActual) => ({
  ...(await importActual<typeof import("./read-registry.ts")>()),
  listRegistry: async () => state.registryRows,
  listOtherIncome: async () => state.incomeRows,
}));

const { serveFile } = await import("./files.ts");
const { exportRegistryCsv, parseYear } = await import("./export.ts");
const { handleOrderUpload, ORDER_UPLOAD_KINDS } = await import("./upload.ts");

const FILE_ID = "0199aaaa-bbbb-7ccc-8ddd-0000000000f1";
const user = (role: SessionUser["role"]): SessionUser => ({
  id: "u1",
  email: "u@nivel.test",
  role,
  telegramUserId: null,
  sessionExpiresAt: new Date(),
});

beforeEach(async () => {
  state.user = user("owner");
  state.rows = [];
  state.registered.length = 0;
  state.stored.length = 0;
  state.audit.length = 0;
  state.guardAllowed = true;
  state.registryRows = [];
  state.incomeRows = [];
  if (!state.filesDir) state.filesDir = await mkdtemp(join(tmpdir(), "nivel-orders-files-"));
});
afterAll(async () => {
  if (state.filesDir) await rm(state.filesDir, { recursive: true, force: true });
});

describe("the file of an order", () => {
  it("is served to who may see orders with the type of the registry and no guessing by the browser", async () => {
    await mkdir(join(state.filesDir, "uploads", "ab"), { recursive: true });
    await writeFile(join(state.filesDir, "uploads", "ab", "x.jpg"), phonePhoto());
    state.rows = [{ storage_key: "uploads/ab/x.jpg", mime: "image/jpeg" }];
    const r = await serveFile(FILE_ID);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/jpeg");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("cache-control")).toContain("no-store");
    expect(r.headers.get("content-security-policy")).toContain("sandbox");
    expect(Buffer.from(await r.arrayBuffer()).equals(phonePhoto())).toBe(true);
  });

  it("serves a PDF without the sandbox that would stop a viewer", async () => {
    await writeFile(join(state.filesDir, "doc.pdf"), "%PDF-1.4");
    state.rows = [{ storage_key: "doc.pdf", mime: "application/pdf" }];
    const r = await serveFile(FILE_ID);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-security-policy")).toBeNull();
  });

  it("refuses nobody signed in, a role that may not, an id that is not an id, an unknown file, a type it does not serve", async () => {
    state.user = null;
    expect((await serveFile(FILE_ID)).status).toBe(401);
    state.user = user("translator");
    expect((await serveFile(FILE_ID)).status).toBe(403);
    state.user = user("owner");
    expect((await serveFile("not-an-id")).status).toBe(404);
    state.rows = [];
    expect((await serveFile(FILE_ID)).status).toBe(404);
    state.rows = [{ storage_key: "uploads/ab/x.svg", mime: "image/svg+xml" }];
    expect((await serveFile(FILE_ID)).status).toBe(404);
  });

  it("does not leave its folder and does not fail on a file that is gone", async () => {
    state.rows = [{ storage_key: "../outside.jpg", mime: "image/jpeg" }];
    expect((await serveFile(FILE_ID)).status).toBe(404);
    state.rows = [{ storage_key: "uploads/zz/missing.jpg", mime: "image/jpeg" }];
    expect((await serveFile(FILE_ID)).status).toBe(404);
  });
});

describe("the CSV of the registry", () => {
  const request = (query = "") => new Request(`http://admin.test/registry/export${query}`);

  it("parses the year of the query and falls back to the current one", () => {
    expect(parseYear(null, 2026)).toBe(2026);
    expect(parseYear("", 2026)).toBe(2026);
    expect(parseYear("2027", 2026)).toBe(2027);
    for (const bad of ["1999", "20x6", "2026; drop", "-2026", "2100000"]) expect(parseYear(bad, 2026)).toBeNull();
  });

  it("gives the owner and the accountant a file with the BOM, and journals the export", async () => {
    state.registryRows = [
      {
        orderId: "o1",
        number: "NV-2026-0001",
        status: "closed",
        received: 100,
        purchased: 90,
        returned: 10,
        losses: 0,
        difference: 0,
        feeIn: 15,
        feeRefunded: 0,
      },
    ];
    state.incomeRows = [
      { id: "i1", year: 2026, period: "2026-09", amountSum: 5, note: "=cmd", enteredBy: "x", createdAt: new Date() },
    ];
    for (const role of ["owner", "accountant"] as const) {
      state.user = user(role);
      state.audit.length = 0;
      const r = await exportRegistryCsv(request("?year=2026"));
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("text/csv; charset=utf-8");
      expect(r.headers.get("content-disposition")).toBe('attachment; filename="registry-2026.csv"');
      const bytes = Buffer.from(await r.arrayBuffer());
      // `Response.text()` drops the BOM: the bytes are what Excel gets.
      expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      const body = bytes.toString("utf8");
      expect(body).toContain("Заказ;NV-2026-0001;Закрыт;100;90;10;0;0;15;0;;;");
      expect(body).toContain("'=cmd");
      expect(state.audit).toEqual([
        {
          actor: "admin:u1",
          action: "registry.export",
          entity: "sales.orders",
          entityId: null,
          after: { year: 2026, rows: 1 },
          ipHash: "h",
        },
      ]);
    }
  });

  it("uses the current year without a query, and refuses nobody, a role that may not, a wrong year", async () => {
    const r = await exportRegistryCsv(request());
    expect(r.headers.get("content-disposition")).toContain("registry-2026.csv");
    state.user = null;
    expect((await exportRegistryCsv(request())).status).toBe(401);
    for (const role of ["assistant", "translator"] as const) {
      state.user = user(role);
      expect((await exportRegistryCsv(request())).status).toBe(403);
    }
    state.user = user("owner");
    expect((await exportRegistryCsv(request("?year=abc"))).status).toBe(400);
    expect(state.audit).toHaveLength(1);
  });
});

describe("the upload of an act photo or a statement", () => {
  const BOUNDARY = "----nivelboundary";

  function multipart(parts: { name: string; value: string | Buffer; filename?: string }[]): {
    body: Buffer;
    headers: Headers;
  } {
    const chunks: Buffer[] = [];
    for (const p of parts) {
      const disposition = `Content-Disposition: form-data; name="${p.name}"${p.filename ? `; filename="${p.filename}"` : ""}`;
      chunks.push(
        Buffer.from(`--${BOUNDARY}\r\n${disposition}\r\n${p.filename ? "Content-Type: image/jpeg\r\n" : ""}\r\n`),
      );
      chunks.push(Buffer.isBuffer(p.value) ? p.value : Buffer.from(p.value));
      chunks.push(Buffer.from("\r\n"));
    }
    chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
    const body = Buffer.concat(chunks);
    return {
      body,
      headers: new Headers({
        "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
        "content-length": String(body.length),
        origin: "http://admin.test",
        host: "admin.test",
        "sec-fetch-site": "same-origin",
      }),
    };
  }
  const post = (m: { body: Buffer; headers: Headers }, headers: Record<string, string> = {}) => {
    const merged = new Headers(m.headers);
    for (const [k, v] of Object.entries(headers)) v === "" ? merged.delete(k) : merged.set(k, v);
    return handleOrderUpload(
      new Request("http://admin.test/orders/upload", { method: "POST", headers: merged, body: new Uint8Array(m.body) }),
    );
  };
  const photo = (kind: string, bytes = phonePhoto()) =>
    multipart([
      { name: "kind", value: kind },
      { name: "photo", value: bytes, filename: "act.jpg" },
    ]);

  it("knows the two kinds of file the base upload does not take and keeps them as order documents", () => {
    expect(Object.keys(ORDER_UPLOAD_KINDS).sort()).toEqual(["act_photo", "third_party_statement"]);
    expect(ORDER_UPLOAD_KINDS.act_photo).toEqual({ retentionClass: "order_warranty_plus_3y", containsPd: true });
  });

  it("cleans the picture, stores it under its hash, registers it with the kind and journals it", async () => {
    const r = await post(photo("act_photo"));
    expect(r.status).toBe(200);
    const body = (await r.json()) as { ok: boolean; file: { id: string; removed: string[] } };
    expect(body.ok).toBe(true);
    expect(body.file.id).toBe(FILE_ID);
    expect(body.file.removed.length).toBeGreaterThan(0);
    expect(state.registered).toHaveLength(1);
    expect(state.registered[0]).toMatchObject({
      kind: "act_photo",
      isPublic: false,
      containsPd: true,
      retentionClass: "order_warranty_plus_3y",
      createdBy: "admin:u1",
      mime: "image/jpeg",
    });
    expect(state.stored[0]).toMatch(/^uploads\/[0-9a-f]{2}\/[0-9a-f]{64}\.jpg$/);
    expect(state.audit[0]).toMatchObject({ action: "files.upload", entity: "ops.files", entityId: FILE_ID });
    state.rows = [{ kind: "act_photo" }];
    const second = await post(photo("act_photo"));
    expect(((await second.json()) as { message: string }).message).toContain("Такой файл уже загружен");
  });

  it("does not hand out a file that was uploaded as another kind of document: the act would be refused later", async () => {
    await post(photo("act_photo"));
    state.rows = [{ kind: "receipt" }];
    const again = await post(photo("act_photo"));
    expect(again.status).toBe(409);
    expect(((await again.json()) as { message: string }).message).toContain("для другого документа");
  });

  it("refuses a kind of the base upload, an unknown kind and an iPhone picture in HEIC with the way out", async () => {
    expect((await post(photo("receipt"))).status).toBe(400);
    expect((await post(photo(""))).status).toBe(400);
    const heic = await post(photo("act_photo", heicPhoto()));
    expect(heic.status).toBe(400);
    expect(((await heic.json()) as { message: string }).message).toMatch(/JPEG|HEIC/);
    expect(state.registered).toHaveLength(0);
  });

  it("refuses a request from another site, nobody signed in, a missing length, a body that is too big, a form that is not one", async () => {
    expect(
      (await post(photo("act_photo"), { origin: "http://evil.test", "sec-fetch-site": "cross-site" })).status,
    ).toBe(403);
    state.guardAllowed = false;
    expect((await post(photo("act_photo"))).status).toBe(403);
    state.guardAllowed = true;
    expect((await post(photo("act_photo"), { "content-length": "" })).status).toBe(411);
    expect((await post(photo("act_photo"), { "content-length": String(20 * 1024 * 1024) })).status).toBe(413);
    expect((await post(photo("act_photo"), { "content-type": "text/plain" })).status).toBe(400);
    expect((await post(multipart([{ name: "kind", value: "act_photo" }]))).status).toBe(400);
    expect((await post(photo("act_photo", Buffer.alloc(0)))).status).toBe(400);
    expect(state.registered).toHaveLength(0);
  });

  it("does not read more than the length it was told", async () => {
    const m = photo("act_photo");
    const r = await post(m, { "content-length": String(m.body.length - 40) });
    expect(r.status).toBe(400);
    expect(state.registered).toHaveLength(0);
  });
});
