// The server action of the upload screen.
import { beforeEach, describe, expect, it, vi } from "vitest";

const app = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../../auth/runtime.ts", () => ({ getRuntime: () => app.current }));
vi.mock("next/headers", async () => (await import("../test-support/fake-app.ts")).nextHeadersMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { createFakeApp } = await import("../test-support/fake-app.ts");
const actions = await import("./actions.ts");

let fake: Awaited<ReturnType<typeof createFakeApp>>;
beforeEach(() => {
  fake = createFakeApp();
  app.current = fake.runtime;
});

const TINY = Buffer.from(
  "/9j/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);
const photo = (secret: string) => {
  const payload = Buffer.from(`Exif\0\0${secret}`, "latin1");
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), head, payload, TINY.subarray(2), Buffer.from([0xff, 0xd9])]);
};

const upload = (bytes: Uint8Array, kind = "receipt") => {
  const data = new FormData();
  data.set("kind", kind);
  data.set("photo", new File([bytes as BlobPart], "IMG.jpg", { type: "image/jpeg" }));
  return data;
};

describe("upload", () => {
  it("stores the photo without its location and says so", async () => {
    await fake.signInAs("assistant");
    const state = await actions.uploadAction({}, upload(photo("GPS-41.29N")));
    expect(state).toMatchObject({ ok: true, message: expect.stringContaining("удалены"), file: { duplicate: false } });
    const [bytes] = [...fake.storedFiles.values()];
    expect(bytes?.toString("latin1")).not.toContain("GPS-41.29N");
    expect(fake.audit.map((a) => a.action)).toContain("files.upload");
  });

  it("the same picture again is one file", async () => {
    await fake.signInAs("owner");
    await actions.uploadAction({}, upload(photo("A-LOCATION")));
    const again = await actions.uploadAction({}, upload(photo("B-DIFFERENT-LOCATION")));
    expect(again).toMatchObject({ ok: true, message: "Такой файл уже загружен: новая копия не создана." });
    expect(fake.storedFiles.size).toBe(1);
  });

  it("refuses no file, a big file, an unknown kind and what is not a picture", async () => {
    await fake.signInAs("owner");
    expect(await actions.uploadAction({}, new FormData())).toEqual({
      ok: false,
      message: "Выберите или снимите фото.",
    });
    expect(await actions.uploadAction({}, upload(new Uint8Array(12 * 1024 * 1024 + 1)))).toEqual({
      ok: false,
      message: "Файл больше 12 МБ.",
    });
    expect(await actions.uploadAction({}, upload(photo("x"), "passport"))).toEqual({
      ok: false,
      message: "Неизвестный вид файла.",
    });
    expect(await actions.uploadAction({}, upload(Buffer.from("MZ not a picture")))).toEqual({
      ok: false,
      message: "Нужен снимок в формате JPEG, PNG или WebP.",
    });
    expect(fake.storedFiles.size).toBe(0);
  });

  it("the translator and a stranger may not upload", async () => {
    expect(await actions.uploadAction({}, upload(photo("x")))).toEqual({
      ok: false,
      message: "Недостаточно прав для этого действия.",
    });
    await fake.signInAs("translator");
    expect(await actions.uploadAction({}, upload(photo("x")))).toEqual({
      ok: false,
      message: "Недостаточно прав для этого действия.",
    });
    expect(fake.storedFiles.size).toBe(0);
    expect(fake.audit.filter((a) => a.action === "files.upload_attempt.denied")).toHaveLength(2);
  });
});
