// The route that receives a photo from the phone (POST /files/upload). It is a route handler and not a server action
// because Next.js refuses the body of a server action above 1 MB, and a phone photo weighs 2-8 MB.
import { beforeEach, describe, expect, it, vi } from "vitest";

const app = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../../auth/runtime.ts", () => ({ getRuntime: () => app.current }));
vi.mock("next/headers", async () => (await import("../test-support/fake-app.ts")).nextHeadersMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { createFakeApp } = await import("../test-support/fake-app.ts");
const { handleUploadRequest, UPLOAD_PATH } = await import("./handler.ts");
const { MAX_UPLOAD_BYTES } = await import("./save.ts");

let fake: Awaited<ReturnType<typeof createFakeApp>>;
beforeEach(() => {
  fake = createFakeApp();
  app.current = fake.runtime;
});

const TINY = Buffer.from(
  "/9j/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);
const photo = (secret: string, padding = 0) => {
  const payload = Buffer.from(`Exif\0\0${secret}`, "latin1");
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  // Padding goes into the picture data (zero bytes), as the weight of a real photo does.
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    head,
    payload,
    TINY.subarray(2, -2),
    Buffer.alloc(padding),
    Buffer.from([0xff, 0xd9]),
  ]);
};

interface Sent {
  kind?: string;
  bytes?: Uint8Array;
  headers?: Record<string, string>;
  contentLength?: number | null;
}

/** A request the way the browser sends it from the page of the admin. */
async function post({ kind = "receipt", bytes, headers = {}, contentLength }: Sent = {}): Promise<Request> {
  const data = new FormData();
  data.set("kind", kind);
  if (bytes) data.set("photo", new File([bytes as BlobPart], "IMG.jpg", { type: "image/jpeg" }));
  const probe = new Request("http://admin.test/x", { method: "POST", body: data });
  const body = Buffer.from(await probe.arrayBuffer());
  const h = new Headers({
    "content-type": probe.headers.get("content-type") ?? "",
    origin: "http://admin.test",
    host: "admin.test",
    "sec-fetch-site": "same-origin",
    ...headers,
  });
  if (contentLength !== null) h.set("content-length", String(contentLength ?? body.length));
  return new Request(`http://admin.test${UPLOAD_PATH}`, { method: "POST", body, headers: h });
}

const answer = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> });

describe("POST /files/upload", () => {
  it("stores a photo of 3 MB, well above the 1 MB of a server action, without its location", async () => {
    await fake.signInAs("assistant");
    const bytes = photo("GPS-41.29N", 3 * 1024 * 1024);
    expect(bytes.length).toBeGreaterThan(3 * 1024 * 1024);
    const { status, body } = await answer(await handleUploadRequest(await post({ bytes })));
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, message: expect.stringContaining("удалены"), file: { duplicate: false } });
    const [stored] = [...fake.storedFiles.values()];
    expect(stored?.length).toBeGreaterThan(3 * 1024 * 1024);
    expect(stored?.toString("latin1")).not.toContain("GPS-41.29N");
    expect(fake.audit.map((a) => a.action)).toContain("files.upload");
  });

  it("the same picture again is one file", async () => {
    await fake.signInAs("owner");
    await handleUploadRequest(await post({ bytes: photo("A-LOCATION") }));
    const again = await answer(await handleUploadRequest(await post({ bytes: photo("B-DIFFERENT-LOCATION") })));
    expect(again.body).toMatchObject({ ok: true, message: "Такой файл уже загружен: новая копия не создана." });
    expect(fake.storedFiles.size).toBe(1);
  });

  it("answers for the form: no file, unknown kind, not a picture", async () => {
    await fake.signInAs("owner");
    expect(await answer(await handleUploadRequest(await post()))).toEqual({
      status: 400,
      body: { ok: false, message: "Выберите или снимите фото." },
    });
    expect(await answer(await handleUploadRequest(await post({ bytes: photo("x"), kind: "passport" })))).toEqual({
      status: 400,
      body: { ok: false, message: "Неизвестный вид файла." },
    });
    expect(await answer(await handleUploadRequest(await post({ bytes: Buffer.from("MZ not a picture") })))).toEqual({
      status: 400,
      body: { ok: false, message: "Нужен снимок в формате JPEG, PNG или WebP." },
    });
    expect(fake.storedFiles.size).toBe(0);
  });

  it("refuses a body above 12 MB by its declared length, before reading it", async () => {
    await fake.signInAs("owner");
    const request = await post({ bytes: photo("x"), contentLength: MAX_UPLOAD_BYTES + 1024 * 1024 });
    const read = vi.spyOn(request, "formData");
    expect(await answer(await handleUploadRequest(request))).toEqual({
      status: 413,
      body: { ok: false, message: "Файл больше 12 МБ." },
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("refuses a file above 12 MB that came in a body of honest length", async () => {
    await fake.signInAs("owner");
    const { status, body } = await answer(
      await handleUploadRequest(await post({ bytes: new Uint8Array(MAX_UPLOAD_BYTES + 1) })),
    );
    expect(status).toBe(413);
    expect(body).toEqual({ ok: false, message: "Файл больше 12 МБ." });
  });

  it("refuses a body of unknown length: the size must be declared", async () => {
    await fake.signInAs("owner");
    const sent = await post({ bytes: photo("x"), contentLength: null });
    expect((await answer(await handleUploadRequest(sent))).status).toBe(411);
  });

  it("refuses what is not a form", async () => {
    await fake.signInAs("owner");
    const request = new Request(`http://admin.test${UPLOAD_PATH}`, {
      method: "POST",
      body: "just text",
      headers: { "content-type": "text/plain", "content-length": "9", origin: "http://admin.test", host: "admin.test" },
    });
    expect(await answer(await handleUploadRequest(request))).toEqual({
      status: 400,
      body: { ok: false, message: "Не удалось прочитать форму." },
    });
  });

  it("refuses a request that did not come from a page of the admin", async () => {
    await fake.signInAs("owner");
    const foreign = await post({ bytes: photo("x"), headers: { origin: "https://evil.example" } });
    expect(await answer(await handleUploadRequest(foreign))).toEqual({
      status: 403,
      body: { ok: false, message: "Запрос не из этой админки отклонён." },
    });
    const noOrigin = await post({ bytes: photo("x"), headers: { origin: "" } });
    expect((await handleUploadRequest(noOrigin)).status).toBe(403);
    expect(fake.storedFiles.size).toBe(0);
  });

  it("the translator and a stranger may not upload; the attempt is journaled", async () => {
    expect(await answer(await handleUploadRequest(await post({ bytes: photo("x") })))).toEqual({
      status: 403,
      body: { ok: false, message: "Недостаточно прав для этого действия." },
    });
    await fake.signInAs("translator");
    expect((await handleUploadRequest(await post({ bytes: photo("x") }))).status).toBe(403);
    expect(fake.storedFiles.size).toBe(0);
    expect(fake.audit.filter((a) => a.action === "files.upload_attempt.denied")).toHaveLength(2);
  });
});
