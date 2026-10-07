import { describe, expect, it, vi } from "vitest";
import { MAX_BYTES, refuseBeforeSending, sendPhoto } from "./upload-client.ts";

describe("the check before a photo is sent", () => {
  it("lets a picture through and refuses an empty file and a file over 12 MB in Russian", () => {
    expect(refuseBeforeSending({ size: 1 })).toBeNull();
    expect(refuseBeforeSending({ size: MAX_BYTES })).toBeNull();
    expect(refuseBeforeSending({ size: 0 })).toBe("Файл пустой.");
    expect(refuseBeforeSending({ size: MAX_BYTES + 1 })).toBe("Файл больше 12 МБ.");
  });
});

describe("sending a photo", () => {
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });

  it("posts the kind and the picture as a form with the cookies of the page, and returns the answer of the server", async () => {
    const doFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = init?.body as FormData;
      expect(body.get("kind")).toBe("act_photo");
      expect(body.get("photo")).toBeInstanceOf(Blob);
      return new Response(JSON.stringify({ ok: true, message: "Файл сохранён.", file: { id: "f1" } }), { status: 200 });
    });
    const answer = await sendPhoto("/orders/upload", blob, "act_photo", doFetch as unknown as typeof fetch);
    expect(answer).toEqual({ ok: true, message: "Файл сохранён.", file: { id: "f1" } });
    expect(doFetch.mock.calls[0]?.[0]).toBe("/orders/upload");
    expect(doFetch.mock.calls[0]?.[1]).toMatchObject({ method: "POST", credentials: "same-origin" });
  });

  it("passes a refusal of the server as it is", async () => {
    const doFetch = async () =>
      new Response(JSON.stringify({ ok: false, message: "Снимок HEIC этот сервер прочитать не может." }), {
        status: 400,
      });
    expect(await sendPhoto("/x", blob, "receipt", doFetch as unknown as typeof fetch)).toEqual({
      ok: false,
      message: "Снимок HEIC этот сервер прочитать не может.",
    });
  });

  it("names the status when the server answers with something that is not its JSON, and the network when there is none", async () => {
    const html = async () => new Response("<html>502</html>", { status: 502 });
    expect((await sendPhoto("/x", blob, "receipt", html as unknown as typeof fetch)).message).toContain("ответ 502");
    const down = async () => {
      throw new TypeError("fetch failed");
    };
    expect((await sendPhoto("/x", blob, "receipt", down as unknown as typeof fetch)).message).toContain(
      "Нет связи с сервером",
    );
  });
});
