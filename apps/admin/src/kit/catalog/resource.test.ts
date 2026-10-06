import { describe, expect, it } from "vitest";
import type { AuditSink } from "../../auth/audit.ts";
import type { SessionUser } from "../../auth/service.ts";
import type { AuditEntry } from "../../auth/store.ts";
import { formDataSource } from "../form.ts";
import type { ListQuery, ResourceStore, StoredRecord, WriteContext } from "../resource.ts";
import { type CatalogValue, createCatalogResource, productKey, slugOf } from "./resource.ts";

class MemoryCatalog implements ResourceStore<CatalogValue> {
  readonly rows = new Map<string, CatalogValue>();
  private seq = 0;
  async list(q: ListQuery) {
    const rows = [...this.rows.entries()].map(([id, value]) => ({ id, value }));
    return { rows: rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), total: rows.length };
  }
  async get(id: string): Promise<StoredRecord<CatalogValue> | null> {
    const value = this.rows.get(id);
    return value ? { id, value } : null;
  }
  async create(value: CatalogValue, ctx: WriteContext) {
    this.seq += 1;
    const id = `p${this.seq}`;
    this.rows.set(id, value);
    await ctx.audit({ action: "create", entityId: id, after: value });
    return { id };
  }
  async update(id: string, value: CatalogValue, ctx: WriteContext) {
    const before = this.rows.get(id);
    this.rows.set(id, value);
    await ctx.audit({ action: "update", entityId: id, before, after: value });
  }
  async findByKey(value: CatalogValue) {
    return [...this.rows.entries()].find(([, v]) => productKey(v) === productKey(value))?.[0] ?? null;
  }
}

const owner: SessionUser = {
  id: "o1",
  email: "o@nivel.uz",
  role: "owner",
  telegramUserId: null,
  sessionExpiresAt: new Date(0),
};
const assistant: SessionUser = { ...owner, id: "a1", role: "assistant" };

function make() {
  const store = new MemoryCatalog();
  const audits: AuditEntry[] = [];
  const sink: AuditSink = { append: async (e) => void audits.push(e) };
  return { store, audits, resource: createCatalogResource(store, sink) };
}

const GPU_CSV = [
  "category,brand,model,mpn,color,lighting,manualOnly,spec.chip,spec.vramGb,spec.lengthMm,spec.heightMm,spec.slots,spec.power.0.conn,spec.power.0.count,spec.adapterInBox,spec.tgpW,spec.hwEncoders",
  "gpu,ASUS,Dual GeForce RTX 5070 OC,DUAL-RTX5070-O12G,black,rgb,нет,GeForce RTX 5070,12,304,126,2.5,12V-2x6,1,да,250,NVENC|AV1",
].join("\n");

describe("catalog resource", () => {
  it("builds a form for every category from the contracts: the fields of the category chosen", () => {
    const { resource } = make();
    const gpu = resource.formModel({ category: "gpu", spec: {} });
    expect(gpu.fields.map((f) => f.key)).toEqual([
      "category",
      "brand",
      "model",
      "mpn",
      "color",
      "lighting",
      "feeGroup",
      "returnable",
      "manualOnly",
      "description",
      "spec",
    ]);
    const spec = gpu.fields.find((f) => f.key === "spec");
    expect(spec?.children?.map((c) => c.key)).toContain("vramGb");
    expect(resource.formModel({ category: "keyboard", spec: {} }).fields.find((f) => f.key === "spec")?.kind).toBe(
      "json",
    );
    expect(resource.formModel({}).fields).toEqual([]);
  });

  it("labels the fields in Russian", () => {
    const { resource } = make();
    expect(resource.labelFor(["spec", "vramGb"])).toBe("Видеопамять, ГБ");
    expect(resource.labelFor(["brand"])).toBe("Бренд");
    expect(resource.labelFor(["spec", "power", "0", "conn"])).toBe("Разъём");
  });

  it("shows the PCIe generation of an SSD only for NVMe", () => {
    const { resource } = make();
    expect(resource.visible(["spec", "pcieGen"], { category: "ssd", spec: { iface: "nvme" } })).toBe(true);
    expect(resource.visible(["spec", "pcieGen"], { category: "ssd", spec: { iface: "sata" } })).toBe(false);
    expect(resource.visible(["spec", "pcieGen"], { category: "mb", spec: {} })).toBe(true);
    expect(resource.visible(["status"], {})).toBe(false);
  });

  it("lists the columns a file for a category may carry, without the hidden fields", () => {
    const { resource } = make();
    const columns = resource.csvColumns("gpu");
    expect(columns.slice(0, 7)).toEqual(["category", "brand", "model", "mpn", "color", "lighting", "feeGroup"]);
    expect(columns).toContain("spec.vramGb");
    expect(columns).toContain("spec.power.0.conn");
    expect(columns).toContain("spec.power.2.count");
    expect(columns).toContain("description.uz");
    expect(columns).not.toContain("status");
    expect(columns).not.toContain("isDemo");
  });

  it("previews a GPU row from a file, and creates it as a draft", async () => {
    const { resource, store, audits } = make();
    const preview = await resource.importPreview(owner, GPU_CSV);
    expect(preview).toMatchObject({ ok: true, counts: { new: 1, update: 0, error: 0 } });
    if (!preview.ok) return;
    expect(preview.rows[0]?.value).toMatchObject({
      category: "gpu",
      brand: "ASUS",
      status: "draft",
      isDemo: false,
      manualOnly: false,
      spec: {
        chip: "GeForce RTX 5070",
        vramGb: 12,
        slots: 2.5,
        power: [{ conn: "12V-2x6", count: 1 }],
        adapterInBox: true,
        hwEncoders: ["NVENC", "AV1"],
        heightMm: 126,
        // not in the file: unknown, never guessed
        vendorRecommendedPsuW: null,
      },
    });
    expect(store.rows.size).toBe(0);

    const applied = await resource.importApply(owner, GPU_CSV);
    expect(applied).toMatchObject({ ok: true, applied: { created: 1, updated: 0 }, failed: [] });
    expect(store.rows.size).toBe(1);
    expect(audits.map((a) => a.action)).toEqual(["catalog.create", "catalog.import"]);
  });

  it("an edit through the form changes the specification and leaves the status alone", async () => {
    const { resource, store } = make();
    await resource.importApply(owner, GPU_CSV);
    const stored = store.rows.get("p1");
    expect(stored?.spec.vramGb).toBe(12);
    const data = new FormData();
    const set = (k: string, v: string) => data.set(k, v);
    set("category", "gpu");
    set("brand", "ASUS");
    set("model", "Dual GeForce RTX 5070 OC");
    set("mpn", "DUAL-RTX5070-O12G");
    set("color", "black");
    set("lighting", "rgb");
    set("manualOnly", "false");
    set("spec.chip", "GeForce RTX 5070");
    set("spec.vramGb", "16");
    set("spec.power.__count", "1");
    set("spec.power.0.conn", "12V-2x6");
    set("spec.power.0.count", "1");
    set("spec.hwEncoders", "NVENC");
    set("status", "verified"); // forged: the status is not a field of the form
    const r = await resource.save(owner, "p1", formDataSource(data));
    expect(r.ok).toBe(true);
    const next = store.rows.get("p1");
    expect(next?.spec.vramGb).toBe(16);
    expect(next?.status).toBe("draft");
  });

  it("reports a bad row with the column and the line, and does not import it", async () => {
    const { resource, store } = make();
    const csv = [GPU_CSV, "gpu,ASUS,Broken,B-1,black,none,нет,GeForce,-4,abc,,,,,,,"].join("\n");
    const preview = await resource.importPreview(owner, csv);
    expect(preview).toMatchObject({ ok: true, counts: { new: 1, error: 1 } });
    if (!preview.ok) return;
    const bad = preview.rows.find((r) => r.status === "error");
    expect(bad?.line).toBe(3);
    expect(bad?.errors["spec.vramGb"]).toBe("Должно быть больше 0.");
    expect(bad?.errors["spec.lengthMm"]).toBe("Нужно число.");
    await resource.importApply(owner, csv);
    expect(store.rows.size).toBe(1);
  });

  it("refuses an unknown category and a repeated position inside the file", async () => {
    const { resource } = make();
    const csv = ["category,brand,model,mpn", "toaster,ASUS,X,", "gpu,ASUS,Dual,M-1", "gpu,asus,Dual again,m-1"].join(
      "\n",
    );
    const preview = await resource.importPreview(owner, csv);
    if (!preview.ok) throw new Error(preview.error);
    expect(preview.rows[0]?.errors.category).toBe("Выберите значение.");
    expect(preview.rows[1]?.status).toBe("new");
    expect(preview.rows[2]?.errors[""]).toMatch(/Повтор в файле: .* строке 3/);
  });

  it("a file cannot publish a position or mark it demo: those columns are unknown", async () => {
    const { resource } = make();
    const preview = await resource.importPreview(owner, "category,brand,model,status\ngpu,A,B,verified\n");
    expect(preview).toEqual({ ok: false, error: "Неизвестные столбцы: status." });
    expect(await resource.importPreview(owner, "category,brand,model,isDemo\ngpu,A,B,да\n")).toEqual({
      ok: false,
      error: "Неизвестные столбцы: isDemo.",
    });
  });

  it("the assistant may look at the catalog but not change or import it", async () => {
    const { resource } = make();
    expect(resource.can(assistant, "read")).toBe(true);
    expect(resource.can(assistant, "write")).toBe(false);
    await expect(resource.importApply(assistant, GPU_CSV)).rejects.toThrow(/forbidden/);
  });

  it("a generic category (keyboard) takes its characteristics as JSON", async () => {
    const { resource, store } = make();
    const csv = ["category,brand,model,spec", 'keyboard,Keychron,K2,"{""switch"":""brown"",""layout"":""ANSI""}"'].join(
      "\n",
    );
    const r = await resource.importApply(owner, csv);
    expect(r).toMatchObject({ ok: true, applied: { created: 1 } });
    expect(store.rows.get("p1")?.spec).toEqual({ switch: "brown", layout: "ANSI" });
  });

  it("makes safe slugs and keys", () => {
    expect(slugOf("ASUS", "Dual GeForce RTX 5070 OC", "DUAL-RTX5070-O12G")).toBe(
      "asus-dual-geforce-rtx-5070-oc-dual-rtx5070-o12g",
    );
    expect(slugOf("Кракен", "Z73")).toBe("z73");
    expect(slugOf("a".repeat(100), "b")).toHaveLength(80);
    expect(productKey({ brand: " ASUS ", model: "M", mpn: " ab-1 " })).toBe("asus|ab-1");
    expect(productKey({ brand: "ASUS", model: "M" })).toBe("asus|model:m");
  });
});
