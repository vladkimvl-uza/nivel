// The server actions of the catalog: form save, status, import in two steps; who may call them.
import { beforeEach, describe, expect, it, vi } from "vitest";

const app = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../../auth/runtime.ts", () => ({ getRuntime: () => app.current }));
vi.mock("next/headers", async () => (await import("../test-support/fake-app.ts")).nextHeadersMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", async () => {
  const { RedirectSignal } = await import("../test-support/fake-app.ts");
  return {
    redirect: (url: string) => {
      throw new RedirectSignal(url);
    },
  };
});

const { createFakeApp, form, RedirectSignal } = await import("../test-support/fake-app.ts");
const actions = await import("./actions.ts");

let fake: Awaited<ReturnType<typeof createFakeApp>>;
beforeEach(() => {
  fake = createFakeApp();
  app.current = fake.runtime;
});

const empty = { errors: {}, values: {} };
const position = (over: Record<string, string> = {}) =>
  form({
    category: "gpu",
    brand: "Gigabyte",
    model: "Eagle OC",
    mpn: "GV-N5070",
    color: "black",
    lighting: "none",
    manualOnly: "false",
    "spec.chip": "GeForce RTX 5070",
    "spec.vramGb": "12",
    ...over,
  });

const csv = (mpn: string) =>
  `category,brand,model,mpn,spec.chip,spec.vramGb\ngpu,ASUS,Dual,${mpn},GeForce RTX 5070,12\ngpu,ASUS,Bad,B-1,GeForce,-4\n`;

describe("save", () => {
  it("creates a position and sends the person to its page", async () => {
    await fake.signInAs("owner");
    const attempt = actions.saveCatalogAction(empty, position());
    await expect(attempt).rejects.toBeInstanceOf(RedirectSignal);
    await expect(attempt).rejects.toMatchObject({ url: expect.stringMatching(/^\/catalog\/p1\?created=1$/) });
    expect(fake.catalogStore.rows.get("p1")).toMatchObject({ brand: "Gigabyte", status: "draft" });
    expect(fake.audit.map((a) => a.action)).toContain("catalog.create");
  });

  it("edits a position and answers with the values to draw", async () => {
    await fake.signInAs("owner");
    await actions.saveCatalogAction(empty, position()).catch(() => {});
    const state = await actions.saveCatalogAction(empty, position({ id: "p1", "spec.vramGb": "16" }));
    expect(state).toMatchObject({ ok: true, message: "Сохранено." });
    expect(fake.catalogStore.rows.get("p1")?.spec.vramGb).toBe(16);
  });

  it("answers with errors by field and keeps what was typed when the position is not valid", async () => {
    await fake.signInAs("owner");
    const state = await actions.saveCatalogAction(empty, position({ model: "" }));
    expect(state.ok).toBe(false);
    expect(state.errors.model).toBe("Обязательное поле.");
    expect(state.message).toContain("не сохранена");
    expect((state.values as { brand: string }).brand).toBe("Gigabyte");
    expect(fake.catalogStore.rows.size).toBe(0);
  });

  it("the assistant may look at the catalog and may not save", async () => {
    await fake.signInAs("assistant");
    const state = await actions.saveCatalogAction(empty, position());
    expect(state).toMatchObject({ ok: false, message: "Недостаточно прав для этого действия." });
    expect(fake.catalogStore.rows.size).toBe(0);
    expect(fake.audit.at(-1)?.action).toBe("catalog.save.denied");
  });
});

describe("status", () => {
  it("changes the status of a position, refuses a status the schema has not, and a stranger", async () => {
    await fake.signInAs("owner");
    await actions.saveCatalogAction(empty, position()).catch(() => {});
    expect(await actions.setCatalogStatusAction({}, form({ id: "p1", status: "retired" }))).toEqual({});
    expect(fake.catalogStore.rows.get("p1")?.status).toBe("retired");
    expect(await actions.setCatalogStatusAction({}, form({ id: "p1", status: "bogus" }))).toEqual({
      error: "Недопустимое значение.",
    });
    expect(await actions.setCatalogStatusAction({}, form({ id: "nope", status: "draft" }))).toEqual({
      error: "Запись не найдена.",
    });
  });

  it("the translator may not", async () => {
    await fake.signInAs("translator");
    expect(await actions.setCatalogStatusAction({}, form({ id: "p1", status: "verified" }))).toEqual({
      error: "Недостаточно прав для этого действия.",
    });
  });
});

describe("import from a file", () => {
  it("previews without writing, then applies exactly the text that was previewed", async () => {
    await fake.signInAs("owner");
    const file = new File([csv("DUAL-1")], "gpu.csv", { type: "text/csv" });
    const data = new FormData();
    data.set("file", file);
    const preview = await actions.previewImportAction({ phase: "idle" }, data);
    expect(preview).toMatchObject({ phase: "preview", counts: { new: 1, update: 0, error: 1 } });
    expect(preview.rows?.[0]).toMatchObject({ line: 2, status: "new", label: "ASUS Dual" });
    expect(preview.rows?.[1]).toMatchObject({ line: 3, status: "error" });
    expect(preview.rows?.[1]?.errors[0]).toMatchObject({ field: "spec.vramGb" });
    expect(fake.catalogStore.rows.size).toBe(0);

    const applied = await actions.applyImportAction({ phase: "idle" }, form({ csv: preview.csv ?? "" }));
    expect(applied).toMatchObject({ phase: "applied", applied: { created: 1, updated: 0 } });
    expect(applied.failed).toHaveLength(1);
    expect(applied.failed?.[0]).toMatchObject({ line: 3 });
    expect(fake.catalogStore.rows.size).toBe(1);
  });

  it("reads the pasted text when there is no file, and says so when there is nothing", async () => {
    await fake.signInAs("owner");
    expect(await actions.previewImportAction({ phase: "idle" }, form({ csv: csv("P-1") }))).toMatchObject({
      phase: "preview",
    });
    expect(await actions.previewImportAction({ phase: "idle" }, form({}))).toEqual({
      phase: "error",
      error: "Выберите файл CSV.",
    });
    expect(await actions.previewImportAction({ phase: "idle" }, form({ csv: "category,nonsense\ngpu,x\n" }))).toEqual({
      phase: "error",
      error: "Неизвестные столбцы: nonsense.",
    });
    expect(await actions.applyImportAction({ phase: "idle" }, form({ csv: "" }))).toEqual({
      phase: "error",
      error: "Файл пуст.",
    });
  });

  // Next.js stops the body of a server action at 1 MB, with the wrapping of the form and the hidden copy of the text in
  // the second step: the file is limited with a margin, so that the message below is what the person sees.
  it("refuses a file over 512 KB, and the same text pasted", async () => {
    await fake.signInAs("owner");
    const data = new FormData();
    data.set("file", new File([new Uint8Array(512 * 1024 + 1)], "big.csv"));
    expect(await actions.previewImportAction({ phase: "idle" }, data)).toEqual({
      phase: "error",
      error: "Файл больше 512 КБ.",
    });
    expect(await actions.previewImportAction({ phase: "idle" }, form({ csv: "я".repeat(300 * 1024) }))).toEqual({
      phase: "error",
      error: "Файл больше 512 КБ.",
    });
  });

  it("reads a file saved by Russian Excel as Windows-1251, and a UTF-8 file with its BOM", async () => {
    await fake.signInAs("owner");
    const text = "category,brand,model,mpn,spec.chip,spec.vramGb\ngpu,АСУС,Двойная,CP-1,GeForce RTX 5070,12\n";
    // Windows-1251: Cyrillic capitals А..Я are C0..DF, small letters E0..FF; the ASCII part is the same.
    const cp1251 = (s: string) =>
      Uint8Array.from([...s].map((c) => (c >= "А" && c <= "я" ? c.charCodeAt(0) - 0x410 + 0xc0 : c.charCodeAt(0))));
    const legacy = new FormData();
    legacy.set("file", new File([cp1251(text)], "excel.csv"));
    const a = await actions.previewImportAction({ phase: "idle" }, legacy);
    expect(a).toMatchObject({ phase: "preview", counts: { new: 1, error: 0 } });
    expect(a.rows?.[0]?.label).toBe("АСУС Двойная");
    expect(a.csv).not.toContain(String.fromCharCode(0xfffd));

    const modern = new FormData();
    modern.set("file", new File([String.fromCharCode(0xfeff), text], "utf8.csv"));
    const b = await actions.previewImportAction({ phase: "idle" }, modern);
    expect(b.rows?.[0]?.label).toBe("АСУС Двойная");
  });

  it("the assistant has no import, in either step", async () => {
    await fake.signInAs("assistant");
    expect(await actions.previewImportAction({ phase: "idle" }, form({ csv: csv("P-2") }))).toEqual({
      phase: "error",
      error: "Недостаточно прав для этого действия.",
    });
    expect(await actions.applyImportAction({ phase: "idle" }, form({ csv: csv("P-2") }))).toEqual({
      phase: "error",
      error: "Недостаточно прав для этого действия.",
    });
    expect(fake.catalogStore.rows.size).toBe(0);
    expect(fake.audit.map((a) => a.action)).toEqual(["catalog.import_preview.denied", "catalog.import_apply.denied"]);
  });
});
