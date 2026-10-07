import { NULLABLE_SPEC_SCHEMAS } from "@nivel/contracts/catalog";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CATALOG_LABELS, OPTION_LABELS } from "../catalog/labels.ts";
import { formDataSource, readFields } from "../form.ts";
import { describeSchema } from "../schema.ts";
import { type FieldsContext, FormFields, labelOf } from "./fields.tsx";

const render = (schema: z.ZodType, ctx: Partial<FieldsContext>): string => {
  const root = describeSchema(schema);
  return renderToStaticMarkup(
    createElement(FormFields, {
      fields: root.children ?? [],
      ctx: { values: {}, errors: {}, labels: {}, ...ctx },
    }),
  );
};

/** The first opening tag of an element with this name attribute. */
const tagOf = (html: string, name: string): string => {
  const m = new RegExp(`<(?:input|select|textarea)[^>]*name="${name.replace(/\./g, "\\.")}"[^>]*>`).exec(html);
  if (!m) throw new Error(`no control named ${name} in ${html}`);
  return m[0];
};

describe("FormFields: scalars", () => {
  const schema = z.object({
    title: z.string().min(1),
    qty: z.number().int().min(1).max(10),
    price: z.number().nullable(),
    on: z.boolean(),
    maybe: z.boolean().nullable(),
    color: z.enum(["black", "white"]),
    day: z.iso.date(),
    note: z.string().max(500).optional(),
  });

  it("draws a labelled control for every field with the stored value", () => {
    const html = render(schema, {
      labels: { title: "Название", qty: "Количество", color: "Цвет" },
      optionLabels: { color: { black: "Чёрный", white: "Белый" } },
      values: { title: "Куб", qty: 3, price: null, on: true, maybe: null, color: "white", day: "2026-10-06" },
    });
    expect(html).toContain('<label class="nv-field__label" for="f-title">Название</label>');
    expect(tagOf(html, "title")).toContain('value="Куб"');
    expect(tagOf(html, "qty")).toContain('value="3"');
    expect(tagOf(html, "qty")).toContain('inputMode="numeric"');
    expect(html).toContain("от 1 до 10");
    expect(tagOf(html, "day")).toContain('type="date"');
    expect(html).toMatch(/<option value="white" selected="">Белый<\/option>/);
    expect(html).toContain('<option value="black">Чёрный</option>');
    expect(html).toMatch(/<textarea[^>]*name="note"/);
  });

  it("says that an empty field means unknown only where null is allowed, and offers yes/no/unknown for a nullable flag", () => {
    const html = render(schema, { values: { price: null, on: false, maybe: null } });
    const priceBlock = html.slice(html.indexOf('name="price"'));
    expect(priceBlock).toContain("пусто — неизвестно");
    expect(html.match(/пусто — неизвестно/g)).toHaveLength(1);
    expect(html).toMatch(/<option value="" selected="">неизвестно<\/option>/);
    // a flag that must be filled has only yes and no
    const onSelect = html.slice(html.indexOf('name="on"'), html.indexOf("</select>", html.indexOf('name="on"')));
    expect(onSelect).not.toContain("неизвестно");
    expect(onSelect).toMatch(/<option value="false" selected="">нет<\/option>/);
  });

  it("shows the message of a field under it, tied to the control", () => {
    const html = render(schema, { errors: { title: "Обязательное поле." } });
    expect(html).toContain('<p class="nv-field__error" id="f-title-error" role="alert">Обязательное поле.</p>');
    expect(tagOf(html, "title")).toContain('aria-invalid="true"');
  });

  it("a required choice has a placeholder, an optional one a dash", () => {
    const html = render(schema, { values: {} });
    expect(html).toMatch(/<option value="" disabled="" selected="">Выберите<\/option>/);
  });

  it("leaves out the fields named as hidden", () => {
    const html = render(schema, { hiddenNames: ["qty", "note"] });
    expect(html).not.toContain('name="qty"');
    expect(html).not.toContain('name="note"');
    expect(html).toContain('name="title"');
  });
});

describe("FormFields: structures", () => {
  const schema = z.object({
    types: z.array(z.enum(["DDR4", "DDR5"])).nullable(),
    power: z.array(z.strictObject({ conn: z.enum(["6pin", "8pin"]), count: z.number().int() })).nullable(),
    dims: z.strictObject({ w: z.number().int(), d: z.number().int() }).nullable(),
    speeds: z.partialRecord(z.enum(["DDR4", "DDR5"]), z.number().int()),
    range: z.tuple([z.number().int(), z.number().int()]),
    title: z.object({ uz: z.string(), ru: z.string() }),
    extra: z.record(z.string(), z.unknown()),
    items: z.array(z.string()),
    fixed: z.literal("gpu"),
  });

  it("a group of checkboxes carries a marker and an unknown box, ticked for an unknown value", () => {
    const html = render(schema, { values: { types: ["DDR5"], power: null, dims: null } });
    expect(html).toContain('name="types.__present"');
    expect(tagOf(html, "types")).toBeDefined();
    expect(html).toMatch(/<input type="checkbox" name="types" checked="" value="DDR5"\/>/);
    expect(html).toMatch(/<input type="checkbox" name="types" value="DDR4"\/>/);
    expect(html).toMatch(/name="types.__unknown"(?![^>]*checked)/);
    expect(html).toMatch(/name="power.__unknown"[^>]*checked=""/);
    expect(html).toMatch(/name="dims.__unknown"[^>]*checked=""/);
  });

  it("a repeated group shows its rows and one spare row, with the count in a hidden field", () => {
    const html = render(schema, { values: { power: [{ conn: "8pin", count: 2 }] } });
    expect(tagOf(html, "power.__count")).toContain('value="2"');
    expect(tagOf(html, "power.0.count")).toContain('value="2"');
    expect(tagOf(html, "power.1.count")).toBeDefined();
    expect(html).toMatch(/<option value="8pin" selected="">8pin<\/option>/);
    expect(html).not.toContain('name="power.2.count"');
  });

  it("a group, a record, a tuple and a localized text name their inputs by path", () => {
    const html = render(schema, {
      values: {
        dims: { w: 10, d: 20 },
        speeds: { DDR4: 3200 },
        range: [150, 190],
        title: { uz: "Salom", ru: "Привет" },
      },
    });
    expect(tagOf(html, "dims.w")).toContain('value="10"');
    expect(tagOf(html, "speeds.DDR4")).toContain('value="3200"');
    expect(tagOf(html, "speeds.DDR5")).toContain('value=""');
    expect(tagOf(html, "range.1")).toContain('value="190"');
    expect(tagOf(html, "title.uz")).toContain('value="Salom"');
    expect(tagOf(html, "title.ru")).toContain('value="Привет"');
  });

  it("JSON is edited as text, a list one value per line, a literal travels hidden", () => {
    const html = render(schema, { values: { extra: { a: 1 }, items: ["x", "y"], fixed: "gpu" } });
    expect(html).toMatch(/<textarea[^>]*name="extra"[^>]*>\{\n {2}&quot;a&quot;: 1\n\}<\/textarea>/);
    expect(html).toMatch(/<textarea[^>]*name="items"[^>]*>x\ny<\/textarea>/);
    expect(tagOf(html, "fixed")).toContain('type="hidden"');
    expect(tagOf(html, "fixed")).toContain('value="gpu"');
  });

  it("what the form draws, the reader reads back unchanged", () => {
    const root = describeSchema(NULLABLE_SPEC_SCHEMAS.gpu);
    const values = {
      chip: "GeForce RTX 5070",
      vramGb: 12,
      lengthMm: 304,
      heightMm: null,
      slots: 2.5,
      power: [{ conn: "8pin", count: 2 }],
      adapterInBox: false,
      tgpW: null,
      vendorRecommendedPsuW: 650,
      hwEncoders: ["NVENC", "AV1"],
    };
    const html = renderToStaticMarkup(
      createElement(FormFields, { fields: root.children ?? [], ctx: { values, errors: {}, labels: CATALOG_LABELS } }),
    );
    // Submit the markup as a browser would: read every control's name and value.
    const data = new FormData();
    for (const m of html.matchAll(/<input[^>]*>/g)) {
      const name = /name="([^"]+)"/.exec(m[0])?.[1];
      const value = /value="([^"]*)"/.exec(m[0])?.[1];
      const type = /type="([^"]+)"/.exec(m[0])?.[1];
      if (!name) continue;
      if (type === "checkbox") {
        if (/checked=""/.test(m[0])) data.append(name, value ?? "on");
      } else data.append(name, (value ?? "").replace(/&quot;/g, '"'));
    }
    for (const m of html.matchAll(/<textarea[^>]*name="([^"]+)"[^>]*>([^<]*)<\/textarea>/g))
      data.append(m[1] ?? "", m[2] ?? "");
    for (const m of html.matchAll(/<select[^>]*name="([^"]+)"[^>]*>(.*?)<\/select>/g)) {
      const selected = /<option value="([^"]*)" selected=""/.exec(m[2] ?? "");
      data.append(m[1] ?? "", selected?.[1] ?? "");
    }
    const { value, problems } = readFields(root, formDataSource(data));
    expect(problems).toEqual({});
    expect(value).toEqual(values);
  });
});

describe("FormFields: sections and labels", () => {
  const schema = z.object({ spec: z.strictObject({ a: z.number(), b: z.number(), c: z.number() }) });

  it("draws a group in titled sections and puts the rest under 'Прочее'", () => {
    const html = render(schema, {
      sections: {
        spec: [
          { title: "Размеры", keys: ["a"] },
          { title: "Питание", keys: ["b"] },
        ],
      },
    });
    expect(html).toContain("<legend>Размеры</legend>");
    expect(html).toContain("<legend>Питание</legend>");
    expect(html).toContain("<legend>Прочее</legend>");
    expect(html.indexOf("Размеры")).toBeLessThan(html.indexOf('name="spec.a"'));
    expect(html.indexOf('name="spec.c"')).toBeGreaterThan(html.indexOf("Прочее"));
  });

  it("looks up a caption by path, then by the last two parts, then by key, then makes one", () => {
    const labels = { "spec.power.conn": "Разъём питания", "m2.id": "Обозначение", vramGb: "Видеопамять, ГБ" };
    expect(labelOf({ labels }, ["spec", "power", "0", "conn"], "conn")).toBe("Разъём питания");
    expect(labelOf({ labels }, ["spec", "m2", "1", "id"], "id")).toBe("Обозначение");
    expect(labelOf({ labels }, ["spec", "vramGb"], "vramGb")).toBe("Видеопамять, ГБ");
    expect(labelOf({ labels }, ["spec", "newKey"], "newKey")).toBe("New key");
  });

  it("the Russian words for options cover the enumerations of the catalog form", () => {
    expect(OPTION_LABELS.color?.black).toBe("Чёрный");
    expect(OPTION_LABELS.modular?.semi).toBe("Частично");
  });
});
