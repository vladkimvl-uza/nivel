import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ForbiddenError, type Role } from "../auth/roles.ts";
import type { SessionUser } from "../auth/service.ts";
import { COUNT_SUFFIX, formDataSource } from "./form.ts";
import type { ResourceStore } from "./resource.ts";
import { defineResource, type ListQuery, RuleViolation, type StoredRecord, type WriteContext } from "./resource.ts";

const schema = z.object({
  name: z.string().min(2),
  kind: z.enum(["a", "b"]),
  qty: z.number().int().min(0),
  note: z.string().optional(),
  extra: z.string().nullable(),
  title: z.object({ uz: z.string(), ru: z.string() }),
  state: z.enum(["draft", "published"]),
});
type Item = z.infer<typeof schema>;

interface Audited {
  action: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

class MemoryStore implements ResourceStore<Item> {
  readonly rows = new Map<string, Item>();
  readonly audits: Audited[] = [];
  lastQuery: ListQuery | null = null;
  failWith: string | null = null;
  private seq = 0;

  async list(q: ListQuery) {
    this.lastQuery = q;
    let all = [...this.rows.entries()].map(([id, value]) => ({ id, value }));
    for (const [field, wanted] of Object.entries(q.filters)) {
      all = all.filter((r) => String((r.value as Record<string, unknown>)[field]) === wanted);
    }
    const total = all.length;
    return { rows: all.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), total };
  }

  async get(id: string): Promise<StoredRecord<Item> | null> {
    const value = this.rows.get(id);
    return value ? { id, value } : null;
  }

  async create(value: Item, ctx: WriteContext) {
    if (this.failWith) throw new RuleViolation(this.failWith);
    this.seq += 1;
    const id = `id-${this.seq}`;
    this.rows.set(id, value);
    await ctx.audit({ action: "create", entityId: id, after: value });
    return { id };
  }

  async update(id: string, value: Item, ctx: WriteContext) {
    if (this.failWith) throw new RuleViolation(this.failWith);
    const before = this.rows.get(id);
    this.rows.set(id, value);
    await ctx.audit({ action: "update", entityId: id, before, after: value });
  }

  async findByKey(value: Item) {
    return [...this.rows.entries()].find(([, v]) => v.name === value.name)?.[0] ?? null;
  }
}

const user = (role: Role): SessionUser => ({
  id: "u1",
  email: "u@nivel.uz",
  role,
  telegramUserId: null,
  sessionExpiresAt: new Date(0),
});

function make(store = new MemoryStore()) {
  const audits: { entity: string; action: string; entityId: string | null; actor: string }[] = [];
  const resource = defineResource({
    name: "items",
    title: "Позиции",
    table: "app.items",
    schema,
    store,
    list: {
      columns: ["name", "kind", "qty"],
      filters: [{ field: "kind", label: "Вид", kind: "select" }],
      defaultSort: "name",
    },
    form: { hidden: ["state"], defaults: { state: "draft" }, conditional: { extra: (v) => v.kind === "b" } },
    localized: ["title"],
    status: {
      field: "state",
      publishGuard: (v) => (v.qty === 0 ? "Нельзя опубликовать с нулевым количеством." : null),
    },
    labels: { name: "Название", kind: "Вид", qty: "Количество" },
    roles: { read: ["owner", "assistant"], write: ["owner"] },
    audit: true,
    auditSink: { append: async (e) => void audits.push(e) },
  });
  return { resource, store, audits };
}

const form = (entries: [string, string][]) => {
  const data = new FormData();
  for (const [k, v] of entries) data.append(k, v);
  return formDataSource(data);
};

const valid: [string, string][] = [
  ["name", "Позиция"],
  ["kind", "a"],
  ["qty", "3"],
  ["title.uz", "Salom"],
  ["title.ru", "Привет"],
  ["state", "draft"],
];

describe("defineResource: access", () => {
  it("lets the read roles list and refuses everyone else", async () => {
    const { resource } = make();
    await expect(resource.list(user("assistant"), {})).resolves.toMatchObject({ total: 0 });
    await expect(resource.list(user("translator"), {})).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("only the write roles save", async () => {
    const { resource, store } = make();
    await expect(resource.save(user("assistant"), null, form(valid))).rejects.toBeInstanceOf(ForbiddenError);
    expect(store.rows.size).toBe(0);
  });

  it("exposes what each role may do for the screens", () => {
    const { resource } = make();
    expect(resource.can(user("owner"), "write")).toBe(true);
    expect(resource.can(user("assistant"), "write")).toBe(false);
    expect(resource.can(user("assistant"), "read")).toBe(true);
    expect(resource.can(user("translator"), "read")).toBe(false);
  });
});

describe("defineResource: save", () => {
  it("validates, writes and journals a new record", async () => {
    const { resource, store, audits } = make();
    const r = await resource.save(user("owner"), null, form(valid));
    expect(r).toMatchObject({ ok: true, id: "id-1" });
    expect(store.rows.get("id-1")).toMatchObject({
      name: "Позиция",
      qty: 3,
      extra: null,
      title: { uz: "Salom", ru: "Привет" },
    });
    expect(audits).toEqual([
      { actor: "admin:u1", action: "items.create", entity: "app.items", entityId: "id-1", after: expect.any(Object) },
    ]);
  });

  it("returns errors by field in Russian and writes nothing", async () => {
    const { resource, store } = make();
    const r = await resource.save(
      user("owner"),
      null,
      form([
        ["name", "x"],
        ["kind", "a"],
        ["qty", "-1"],
        ["title.uz", ""],
        ["title.ru", ""],
        ["state", "draft"],
      ]),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toMatchObject({ name: "Не короче 2 знаков.", qty: "Не меньше 0." });
    expect(store.rows.size).toBe(0);
  });

  it("updates, keeping the stored value of fields the form did not show", async () => {
    const { resource, store } = make();
    await resource.save(
      user("owner"),
      null,
      form([...valid.map(([k, v]): [string, string] => (k === "kind" ? [k, "b"] : [k, v])), ["extra", "keep me"]]),
    );
    // `extra` is shown only for kind b; the edit switches to a: the stored value must not be wiped by the missing field.
    const r = await resource.save(
      user("owner"),
      "id-1",
      form(valid.map(([k, v]) => (k === "kind" ? [k, "a"] : [k, v])) as [string, string][]),
    );
    expect(r.ok).toBe(true);
    expect(store.rows.get("id-1")?.extra).toBe("keep me");
  });

  it("a field named in `hidden` is never taken from the form", async () => {
    const { resource, store } = make();
    await resource.save(user("owner"), null, form(valid));
    const forged: [string, string][] = valid.map(([k, v]) => (k === "state" ? [k, "published"] : [k, v]));
    await resource.save(user("owner"), "id-1", form(forged));
    expect(store.rows.get("id-1")?.state).toBe("draft");
  });

  it("a rule of the store (database) comes back as a message, not an exception", async () => {
    const { resource, store } = make();
    store.failWith = "Такая позиция уже есть.";
    const r = await resource.save(user("owner"), null, form(valid));
    expect(r).toEqual({ ok: false, errors: { "": "Такая позиция уже есть." }, value: expect.any(Object) });
  });

  it("an unknown id is not found", async () => {
    const { resource } = make();
    await expect(resource.save(user("owner"), "nope", form(valid))).resolves.toEqual({
      ok: false,
      errors: { "": "Запись не найдена." },
      value: expect.any(Object),
    });
  });
});

describe("defineResource: publishing", () => {
  it("uz text is required to publish, the guard of the resource can refuse too", async () => {
    // `state` is hidden from the form, so publishing is a separate act of the resource.
    const { resource, store } = make();
    await resource.save(user("owner"), null, form([...valid.filter(([k]) => k !== "title.uz"), ["title.uz", ""]]));
    const published = await resource.setStatus(user("owner"), "id-1", "published");
    expect(published).toEqual({ ok: false, errors: { "title.uz": "Узбекский текст обязателен для публикации." } });
    store.rows.set("id-1", { ...(store.rows.get("id-1") as Item), title: { uz: "Salom", ru: "" }, qty: 0 });
    expect(await resource.setStatus(user("owner"), "id-1", "published")).toEqual({
      ok: false,
      errors: { state: "Нельзя опубликовать с нулевым количеством." },
    });
    store.rows.set("id-1", { ...(store.rows.get("id-1") as Item), qty: 2 });
    expect(await resource.setStatus(user("owner"), "id-1", "published")).toMatchObject({ ok: true });
    expect(store.rows.get("id-1")?.state).toBe("published");
  });

  it("refuses a status that the schema does not have, and a stranger", async () => {
    const { resource } = make();
    await resource.save(user("owner"), null, form(valid));
    expect(await resource.setStatus(user("owner"), "id-1", "bogus")).toEqual({
      ok: false,
      errors: { state: "Недопустимое значение." },
    });
    await expect(resource.setStatus(user("assistant"), "id-1", "published")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("defineResource: list", () => {
  async function seeded() {
    const made = make();
    for (const [name, kind] of [
      ["Альфа", "a"],
      ["Бета", "b"],
      ["Гамма", "a"],
    ] as const) {
      await made.resource.save(
        user("owner"),
        null,
        form(
          valid.map(([k, v]) => (k === "name" ? [k, name] : k === "kind" ? [k, kind] : [k, v])) as [string, string][],
        ),
      );
    }
    return made;
  }

  it("shows the columns of the definition as text and paginates", async () => {
    const { resource } = await seeded();
    const page = await resource.list(user("owner"), { page: "1" });
    expect(page.columns.map((c) => c.key)).toEqual(["name", "kind", "qty"]);
    expect(page.columns[0]).toMatchObject({ label: "Название" });
    expect(page.rows[0]?.cells).toEqual(["Альфа", "a", "3"]);
    expect(page).toMatchObject({ total: 3, page: 1, pages: 1 });
  });

  it("passes only known filters and sorts to the store", async () => {
    const { resource, store } = await seeded();
    const page = await resource.list(user("owner"), { kind: "a", evil: "1; drop table", sort: "-qty", page: "1" });
    expect(page.total).toBe(2);
    expect(store.lastQuery?.filters).toEqual({ kind: "a" });
    expect(store.lastQuery?.sort).toEqual({ field: "qty", dir: "desc" });
    await resource.list(user("owner"), { sort: "password_hash" });
    expect(store.lastQuery?.sort).toEqual({ field: "name", dir: "asc" });
  });

  it("clamps junk page numbers and drops a filter value the options do not allow", async () => {
    const { resource, store } = await seeded();
    await resource.list(user("owner"), { page: "-4" });
    expect(store.lastQuery?.page).toBe(1);
    await resource.list(user("owner"), { page: "abc" });
    expect(store.lastQuery?.page).toBe(1);
    await resource.list(user("owner"), { kind: "zzz" });
    expect(store.lastQuery?.filters).toEqual({});
  });
});

describe("defineResource: form model", () => {
  it("lists the visible fields, honoring hidden and conditional ones", async () => {
    const { resource } = make();
    const model = resource.formModel({
      name: "x",
      kind: "a",
      qty: 1,
      extra: null,
      title: { uz: "", ru: "" },
      state: "draft",
    });
    expect(model.fields.map((f) => f.key)).toEqual(["name", "kind", "qty", "note", "title"]);
    const shown = resource.formModel({
      name: "x",
      kind: "b",
      qty: 1,
      extra: null,
      title: { uz: "", ru: "" },
      state: "draft",
    });
    expect(shown.fields.map((f) => f.key)).toEqual(["name", "kind", "qty", "note", "extra", "title"]);
    expect(shown.fields.find((f) => f.key === "name")?.label).toBe("Название");
    expect(shown.fields.find((f) => f.key === "title")?.kind).toBe("localized");
  });

  it("tells the reader of a file which fields a row may carry", () => {
    const { resource } = make();
    expect(resource.csvColumns(undefined)).toEqual(["name", "kind", "qty", "note", "extra", "title.uz", "title.ru"]);
  });

  it("a repeated group is sent with its hidden count", () => {
    expect(COUNT_SUFFIX).toBe("__count");
  });
});

describe("defineResource: import from a file", () => {
  const csv = (rows: string[]) => ["name,kind,qty,title.uz,title.ru", ...rows].join("\n");

  it("previews every row: new, update, error, and writes nothing", async () => {
    const { resource, store } = make();
    await resource.save(user("owner"), null, form(valid));
    const preview = await resource.importPreview(
      user("owner"),
      csv(["Позиция,b,5,U,R", "Новая,a,1,U,R", "Плохая,zzz,-1,U,R", "Короткая,a"]),
    );
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    expect(preview.counts).toEqual({ new: 1, update: 1, error: 2 });
    expect(preview.rows.map((r) => [r.line, r.status])).toEqual([
      [2, "update"],
      [3, "new"],
      [4, "error"],
      [5, "error"],
    ]);
    expect(preview.rows[2]?.errors).toMatchObject({ kind: "Недопустимое значение.", qty: "Не меньше 0." });
    expect(preview.rows[3]?.errors[""]).toBe("В строке 2 значений вместо 5.");
    expect(store.rows.size).toBe(1);
  });

  it("applies the valid rows, journals each, and reports the rest", async () => {
    const { resource, store, audits } = make();
    const r = await resource.importApply(user("owner"), csv(["Новая,a,1,U,R", "Плохая,zzz,1,U,R", "Ещё,b,2,U,R"]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.applied).toEqual({ created: 2, updated: 0 });
    expect(r.failed).toHaveLength(1);
    expect(store.rows.size).toBe(2);
    expect(audits.map((a) => a.action)).toEqual(["items.create", "items.create", "items.import"]);
    expect(audits.at(-1)).toMatchObject({ after: { created: 2, updated: 0, failed: 1 } });
  });

  it("a second import of the same file updates instead of duplicating", async () => {
    const { resource, store } = make();
    const text = csv(["Новая,a,1,U,R"]);
    await resource.importApply(user("owner"), text);
    const again = await resource.importApply(user("owner"), text.replace(",1,U,R", ",9,U,R"));
    expect(again).toMatchObject({ ok: true, applied: { created: 0, updated: 1 } });
    expect(store.rows.size).toBe(1);
    expect(store.rows.get("id-1")?.qty).toBe(9);
  });

  it("refuses unknown columns instead of ignoring them silently, and a broken file", async () => {
    const { resource } = make();
    const unknown = await resource.importPreview(user("owner"), "name,kind,qty,colour\nA,a,1,red\n");
    expect(unknown).toEqual({ ok: false, error: "Неизвестные столбцы: colour." });
    expect(await resource.importPreview(user("owner"), "")).toEqual({ ok: false, error: "Файл пуст." });
  });

  it("only the write roles import", async () => {
    const { resource } = make();
    await expect(resource.importPreview(user("assistant"), csv([]))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(resource.importApply(user("assistant"), csv(["A,a,1,U,R"]))).rejects.toBeInstanceOf(ForbiddenError);
  });
});
