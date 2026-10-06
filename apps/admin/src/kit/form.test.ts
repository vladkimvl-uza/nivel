import { NULLABLE_SPEC_SCHEMAS, ProductSpecsSchema } from "@nivel/contracts/catalog";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  COUNT_SUFFIX,
  cellsSource,
  formatIssues,
  formDataSource,
  nameOf,
  PRESENT_SUFFIX,
  readFields,
  UNKNOWN_SUFFIX,
  valueAt,
} from "./form.ts";
import { describeSchema } from "./schema.ts";

const fd = (entries: [string, string][]) => {
  const data = new FormData();
  for (const [k, v] of entries) data.append(k, v);
  return formDataSource(data);
};

describe("readFields: scalars", () => {
  const schema = z.object({
    title: z.string().min(1),
    note: z.string().optional(),
    qty: z.number().int(),
    price: z.number().nullable(),
    on: z.boolean(),
    maybe: z.boolean().nullable(),
    slots: z.union([z.literal(2), z.literal(4)]),
    color: z.enum(["black", "white"]),
  });
  const node = describeSchema(schema);

  it("reads typed values from form fields", () => {
    const { value, problems } = readFields(
      node,
      fd([
        ["title", "  Видеокарта  "],
        ["qty", "12"],
        ["price", "1 250,5"],
        ["on", "true"],
        ["maybe", "false"],
        ["slots", "4"],
        ["color", "white"],
      ]),
    );
    expect(problems).toEqual({});
    expect(value).toEqual({
      title: "Видеокарта",
      qty: 12,
      price: 1250.5,
      on: true,
      maybe: false,
      slots: 4,
      color: "white",
    });
    expect(schema.safeParse(value).success).toBe(true);
  });

  it("blank means unknown (null) for a nullable field, absent for an optional one", () => {
    const { value } = readFields(
      node,
      fd([
        ["title", "x"],
        ["note", ""],
        ["qty", "1"],
        ["price", ""],
        ["on", "false"],
        ["maybe", ""],
        ["slots", "2"],
        ["color", "black"],
      ]),
    );
    expect(value).toMatchObject({ price: null, maybe: null });
    expect(value).not.toHaveProperty("note");
  });

  it("reports a number that is not a number instead of guessing", () => {
    const { value, problems } = readFields(
      node,
      fd([
        ["qty", "12abc"],
        ["price", "1,2,3"],
      ]),
    );
    expect(problems.qty).toBe("Нужно число.");
    expect(problems.price).toBe("Нужно число.");
    expect((value as Record<string, unknown>).qty).toBe("12abc");
  });

  it("a required blank field stays undefined so validation reports it", () => {
    const { value } = readFields(node, fd([]));
    expect((value as Record<string, unknown>).title).toBeUndefined();
    const parsed = schema.safeParse(value);
    expect(parsed.success).toBe(false);
  });

  it("does not take a value outside the allowed options", () => {
    const { value } = readFields(
      node,
      fd([
        ["slots", "3"],
        ["color", "red"],
      ]),
    );
    expect(
      schema.safeParse({ ...(value as object), title: "t", qty: 1, on: true, maybe: null, price: null }).success,
    ).toBe(false);
  });
});

describe("readFields: structures", () => {
  const schema = z.object({
    types: z.array(z.enum(["DDR4", "DDR5"])).nullable(),
    power: z.array(z.strictObject({ conn: z.enum(["6pin", "8pin"]), count: z.number().int().positive() })).nullable(),
    encoders: z.array(z.string().min(1)),
    speeds: z.partialRecord(z.enum(["DDR4", "DDR5"]), z.number().int().positive()).nullable(),
    height: z.tuple([z.number().int(), z.number().int()]).nullable(),
    dims: z.strictObject({ w: z.number().int(), d: z.number().int() }).nullable(),
    extra: z.record(z.string(), z.string()).nullable(),
    title: z.object({ uz: z.string(), ru: z.string() }),
  });
  const node = describeSchema(schema);

  it("multiselect: all ticked values, in the order of the form", () => {
    const { value } = readFields(
      node,
      fd([
        ["types", "DDR5"],
        ["types", "DDR4"],
      ]),
    );
    expect((value as Record<string, unknown>).types).toEqual(["DDR5", "DDR4"]);
    // The form sends a marker: nothing ticked then means "none", not "unknown".
    const none = readFields(node, fd([[`types.${PRESENT_SUFFIX}`, "1"]])).value as Record<string, unknown>;
    expect(none.types).toEqual([]);
  });

  it("the unknown box turns a whole structure into null, the empty form into an empty list", () => {
    const unknown = readFields(
      node,
      fd([
        [`types.${UNKNOWN_SUFFIX}`, "1"],
        [`power.${UNKNOWN_SUFFIX}`, "on"],
      ]),
    ).value as Record<string, unknown>;
    expect(unknown.types).toBeNull();
    expect(unknown.power).toBeNull();
    const empty = readFields(
      node,
      fd([
        [`power.${COUNT_SUFFIX}`, "2"],
        [`types.${PRESENT_SUFFIX}`, "1"],
      ]),
    ).value as Record<string, unknown>;
    expect(empty.power).toEqual([]);
    expect(empty.types).toEqual([]);
  });

  it("an array of objects: rows by index, blank rows skipped", () => {
    const { value } = readFields(
      node,
      fd([
        [`power.${COUNT_SUFFIX}`, "3"],
        ["power.0.conn", "8pin"],
        ["power.0.count", "2"],
        ["power.1.conn", "6pin"],
        ["power.1.count", ""],
        ["power.2.conn", ""],
        ["power.2.count", ""],
      ]),
    );
    // Row 1 is half filled: kept, so that validation names the missing count; row 2 is empty: dropped.
    expect((value as { power: unknown[] }).power).toEqual([{ conn: "8pin", count: 2 }, { conn: "6pin" }]);
  });

  it("a list: one value per line, or separated by ; and commas, empties dropped", () => {
    const { value } = readFields(node, fd([["encoders", "NVENC\n AV1 ;\n\nH.265, VP9 "]]));
    expect((value as { encoders: string[] }).encoders).toEqual(["NVENC", "AV1", "H.265", "VP9"]);
  });

  it("a record: only the filled keys", () => {
    const { value } = readFields(
      node,
      fd([
        ["speeds.DDR4", "3200"],
        ["speeds.DDR5", ""],
      ]),
    );
    expect((value as { speeds: unknown }).speeds).toEqual({ DDR4: 3200 });
  });

  it("a tuple keeps its positions; all blank and nullable is unknown", () => {
    expect(
      (
        readFields(
          node,
          fd([
            ["height.0", "150"],
            ["height.1", "190"],
          ]),
        ).value as { height: unknown }
      ).height,
    ).toEqual([150, 190]);
    expect(
      (
        readFields(
          node,
          fd([
            ["height.0", ""],
            ["height.1", ""],
          ]),
        ).value as { height: unknown }
      ).height,
    ).toBeNull();
  });

  it("a nullable group with every field blank is unknown, with one filled it is an object", () => {
    expect(
      (
        readFields(
          node,
          fd([
            ["dims.w", ""],
            ["dims.d", ""],
          ]),
        ).value as { dims: unknown }
      ).dims,
    ).toBeNull();
    expect(
      (
        readFields(
          node,
          fd([
            ["dims.w", "10"],
            ["dims.d", ""],
          ]),
        ).value as { dims: unknown }
      ).dims,
    ).toEqual({ w: 10 });
  });

  it("JSON text is parsed; broken JSON is reported", () => {
    const ok = readFields(node, fd([["extra", '{"a":"b"}']])).value as { extra: unknown };
    expect(ok.extra).toEqual({ a: "b" });
    const bad = readFields(node, fd([["extra", "{not json"]]));
    expect(bad.problems.extra).toBe("Некорректный JSON.");
  });

  it("a localized text reads both languages", () => {
    const { value } = readFields(
      node,
      fd([
        ["title.uz", "Salom"],
        ["title.ru", "Привет"],
      ]),
    );
    expect((value as { title: unknown }).title).toEqual({ uz: "Salom", ru: "Привет" });
    const blank = readFields(node, fd([])).value as { title: unknown };
    expect(blank.title).toEqual({ uz: "", ru: "" });
  });

  it("keeps the previous value of a field the form did not show", () => {
    const previous = { dims: { w: 5, d: 6 }, types: ["DDR4"] };
    const { value } = readFields(node, fd([["types", "DDR5"]]), {
      previous,
      keep: (name) => name === "dims",
    });
    expect((value as Record<string, unknown>).dims).toEqual({ w: 5, d: 6 });
    expect((value as Record<string, unknown>).types).toEqual(["DDR5"]);
  });
});

describe("readFields: variant (a catalog position)", () => {
  const node = describeSchema(ProductSpecsSchema);

  it.each(["constructor", "__proto__", "toString"])("a category named %s is a wrong value, not a crash", (name) => {
    const { problems } = readFields(node, fd([["category", name]]));
    expect(problems).toEqual({ category: "Выберите значение." });
  });

  it("reads the arm named by the category", () => {
    const { value, problems } = readFields(
      node,
      fd([
        ["category", "gpu"],
        ["spec.chip", "RTX 5070"],
        ["spec.vramGb", "12"],
        ["spec.lengthMm", "304"],
        ["spec.slots", "2.5"],
        [`spec.power.${COUNT_SUFFIX}`, "1"],
        ["spec.power.0.conn", "12V-2x6"],
        ["spec.power.0.count", "1"],
        ["spec.hwEncoders", "NVENC\nAV1"],
        [`spec.heightMm.${UNKNOWN_SUFFIX}`, "x"],
      ]),
    );
    expect(problems).toEqual({});
    const spec = (value as { spec: Record<string, unknown> }).spec;
    expect(spec).toMatchObject({
      chip: "RTX 5070",
      vramGb: 12,
      lengthMm: 304,
      slots: 2.5,
      power: [{ conn: "12V-2x6", count: 1 }],
      hwEncoders: ["NVENC", "AV1"],
      tgpW: null,
      adapterInBox: null,
    });
    expect(ProductSpecsSchema.safeParse(value).success).toBe(true);
  });

  it("a category that is not chosen is a problem, not a guess", () => {
    const { problems } = readFields(node, fd([["spec.chip", "x"]]));
    expect(problems.category).toBe("Выберите значение.");
  });

  it("an unknown draft form (everything unknown) is valid for every category", () => {
    for (const category of ["gpu", "cpu", "case", "chair"] as const) {
      const entries: [string, string][] = [["category", category]];
      const arm = node.arms?.[category] ?? [];
      const spec = arm.find((f) => f.key === "spec");
      for (const f of spec?.children ?? []) {
        if (
          f.kind === "group" ||
          f.kind === "multiselect" ||
          f.kind === "array" ||
          f.kind === "record" ||
          f.kind === "tuple"
        ) {
          entries.push([`spec.${f.key}.${UNKNOWN_SUFFIX}`, "1"]);
        }
      }
      const { value } = readFields(node, fd(entries));
      const parsed = ProductSpecsSchema.safeParse(value);
      expect(parsed.success, `${category}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
    }
  });
});

describe("cells source (CSV rows)", () => {
  const schema = NULLABLE_SPEC_SCHEMAS.gpu;
  const node = describeSchema(schema);

  it("reads a row by column names; arrays of values are separated by |", () => {
    const source = cellsSource(
      ["chip", "vramGb", "lengthMm", "hwEncoders", "power.0.conn", "power.0.count", "power.1.conn", "power.1.count"],
      ["RTX 5070", "12", "304", "NVENC|AV1", "8pin", "1", "12V-2x6", "1"],
    );
    const { value } = readFields(node, source);
    expect(value).toMatchObject({
      chip: "RTX 5070",
      vramGb: 12,
      hwEncoders: ["NVENC", "AV1"],
      power: [
        { conn: "8pin", count: 1 },
        { conn: "12V-2x6", count: 1 },
      ],
      tgpW: null,
      adapterInBox: null,
    });
  });

  it("accepts a JSON cell for an array of objects", () => {
    const source = cellsSource(["power"], ['[{"conn":"8pin","count":2}]']);
    const { value } = readFields(node, source);
    expect((value as { power: unknown }).power).toEqual([{ conn: "8pin", count: 2 }]);
  });

  it("a column that is not in the file is unknown for a nullable field; yes/no spellings are understood", () => {
    const source = cellsSource(["adapterInBox"], ["да"]);
    const { value } = readFields(node, source);
    expect(value).toMatchObject({ adapterInBox: true, chip: null, power: null });
    expect(readFields(node, cellsSource(["adapterInBox"], ["Нет"])).value).toMatchObject({ adapterInBox: false });
    expect(readFields(node, cellsSource(["adapterInBox"], ["yes"])).value).toMatchObject({ adapterInBox: true });
  });
});

describe("helpers", () => {
  it("nameOf joins a path", () => {
    expect(nameOf(["spec", "power", "0", "conn"])).toBe("spec.power.0.conn");
  });

  it("valueAt walks objects and arrays and survives gaps", () => {
    const v = { spec: { power: [{ conn: "8pin" }] } };
    expect(valueAt(v, ["spec", "power", "0", "conn"])).toBe("8pin");
    expect(valueAt(v, ["spec", "nope", "0"])).toBeUndefined();
    expect(valueAt(null, ["a"])).toBeUndefined();
  });
});

describe("formatIssues: validation errors in Russian", () => {
  const messages = (schema: z.ZodType, input: unknown) => {
    const r = schema.safeParse(input);
    if (r.success) throw new Error("expected a failure");
    return formatIssues(r.error.issues);
  };

  it("names what is wrong, per path", () => {
    const schema = z.object({
      a: z.string().min(3),
      b: z.number().int().positive(),
      c: z.enum(["x", "y"]),
      d: z.array(z.string()).min(1),
      e: z.string().regex(/^\d+$/),
      f: z.number().max(10),
      g: z.string(),
      h: z.number(),
    });
    const out = messages(schema, { a: "ab", b: 0, c: "z", d: [], e: "a", f: 11, h: "x" });
    expect(out).toEqual({
      a: "Не короче 3 знаков.",
      b: "Должно быть больше 0.",
      c: "Недопустимое значение.",
      d: "Выберите не меньше 1.",
      e: "Неверный формат.",
      f: "Не больше 10.",
      g: "Обязательное поле.",
      h: "Нужно число.",
    });
  });

  it("keeps the message of a custom check and joins nested paths", () => {
    const schema = z.object({
      spec: z
        .object({ a: z.number(), b: z.number() })
        .refine((v) => v.a <= v.b, { error: "a must not exceed b", path: ["a"] }),
    });
    expect(messages(schema, { spec: { a: 2, b: 1 } })).toEqual({ "spec.a": "a must not exceed b" });
  });

  it("flags unknown keys and gives the first message per path", () => {
    const schema = z.strictObject({ a: z.string() });
    expect(messages(schema, { a: "x", zz: 1 })).toEqual({ "": "Лишние поля: zz." });
  });
});
