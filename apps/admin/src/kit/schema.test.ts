import {
  CpuSpecsSchema,
  GpuSpecsSchema,
  NULLABLE_SPEC_SCHEMAS,
  ProductBaseSchema,
  ProductSpecsSchema,
} from "@nivel/contracts/catalog";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { describeSchema, fieldsOf, findNode, humanize } from "./schema.ts";

const child = (node: ReturnType<typeof describeSchema>, key: string) => {
  const found = node.children?.find((c) => c.key === key);
  if (!found) throw new Error(`no field ${key}`);
  return found;
};

describe("describeSchema: primitives", () => {
  const node = describeSchema(
    z.object({
      name: z.string().min(2).max(40),
      note: z.string().max(500).optional(),
      qty: z.number().int().min(1).max(10),
      weight: z.number().nonnegative(),
      on: z.boolean(),
      color: z.enum(["black", "white"]),
      day: z.iso.date(),
      code: z.string().regex(/^[A-Z]{3}$/),
      cheap: z.number().int().nullable(),
      since: z.number().default(3),
    }),
  );

  it("maps each type to a field kind with its limits", () => {
    expect(child(node, "name")).toMatchObject({
      kind: "text",
      minLength: 2,
      maxLength: 40,
      optional: false,
      nullable: false,
    });
    expect(child(node, "note")).toMatchObject({ kind: "longtext", optional: true });
    expect(child(node, "qty")).toMatchObject({ kind: "integer", min: 1, max: 10 });
    expect(child(node, "weight")).toMatchObject({ kind: "number", min: 0 });
    expect(child(node, "weight").max).toBeUndefined();
    expect(child(node, "on").kind).toBe("boolean");
    expect(child(node, "color")).toMatchObject({
      kind: "select",
      options: [
        { value: "black", label: "black" },
        { value: "white", label: "white" },
      ],
    });
    expect(child(node, "day").kind).toBe("date");
    expect(child(node, "code").pattern).toBe("^[A-Z]{3}$");
  });

  it("does not show the safe-integer extremes of .int() as limits", () => {
    expect(child(node, "cheap").max).toBeUndefined();
    expect(child(node, "cheap").min).toBeUndefined();
  });

  it("tells optional, nullable and default apart", () => {
    expect(child(node, "cheap")).toMatchObject({ nullable: true, optional: false });
    expect(child(node, "since")).toMatchObject({ optional: true, nullable: false });
    expect(child(node, "name")).toMatchObject({ optional: false, nullable: false });
  });

  it("refuses a schema that is not an object", () => {
    expect(() => describeSchema(z.string())).toThrow(/object/);
  });

  it("a refined object (cross-field checks) is still a group", () => {
    const refined = describeSchema(z.object({ a: z.number(), b: z.number() }).refine((v) => v.a <= v.b));
    expect(refined.children?.map((c) => c.key)).toEqual(["a", "b"]);
  });
});

describe("describeSchema: structures", () => {
  it("a union of literals is a select; numbers stay numeric", () => {
    const node = describeSchema(z.object({ slots: z.union([z.literal(2), z.literal(4)]), gen: z.literal(5) }));
    expect(child(node, "slots")).toMatchObject({
      kind: "select",
      numericOptions: true,
      options: [
        { value: "2", label: "2" },
        { value: "4", label: "4" },
      ],
    });
    expect(child(node, "gen")).toMatchObject({ kind: "literal", literal: 5 });
  });

  it("an array of enum values is a multiselect, of objects a repeated group, of strings a list", () => {
    const node = describeSchema(
      z.object({
        types: z.array(z.enum(["DDR4", "DDR5"])).min(1),
        power: z.array(z.strictObject({ conn: z.enum(["6pin", "8pin"]), count: z.number().int().positive() })),
        encoders: z.array(z.string().min(1)),
      }),
    );
    expect(child(node, "types")).toMatchObject({
      kind: "multiselect",
      options: [{ value: "DDR4" }, { value: "DDR5" }],
    });
    const power = child(node, "power");
    expect(power.kind).toBe("array");
    expect(power.item?.children?.map((c) => [c.key, c.kind])).toEqual([
      ["conn", "select"],
      ["count", "integer"],
    ]);
    expect(child(node, "encoders")).toMatchObject({ kind: "list", item: { kind: "text" } });
  });

  it("a tuple has one child per position", () => {
    const node = describeSchema(z.object({ range: z.tuple([z.number().int(), z.number().int()]) }));
    expect(child(node, "range").children?.map((c) => [c.key, c.kind])).toEqual([
      ["0", "integer"],
      ["1", "integer"],
    ]);
  });

  it("a partial record over an enum is one optional number per key; any other record is JSON", () => {
    const node = describeSchema(
      z.object({
        speeds: z.partialRecord(z.enum(["DDR4", "DDR5"]), z.number().int().positive()),
        free: z.record(z.string(), z.unknown()),
      }),
    );
    const speeds = child(node, "speeds");
    expect(speeds.kind).toBe("record");
    expect(speeds.children?.map((c) => [c.key, c.kind, c.optional])).toEqual([
      ["DDR4", "integer", true],
      ["DDR5", "integer", true],
    ]);
    expect(child(node, "free").kind).toBe("json");
  });

  it("{ uz, ru } is a localized text", () => {
    const node = describeSchema(z.object({ title: z.object({ uz: z.string(), ru: z.string() }) }));
    expect(child(node, "title").kind).toBe("localized");
  });

  it("an intersection of objects is one group", () => {
    const node = describeSchema(z.object({ a: z.string() }).and(z.object({ b: z.number() })));
    expect(node.children?.map((c) => c.key)).toEqual(["a", "b"]);
  });

  it("a discriminated union is a variant with the fields of each arm", () => {
    const node = describeSchema(
      z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("a"), x: z.string() }),
        z.object({ kind: z.literal("b"), y: z.number() }),
      ]),
    );
    expect(node.kind).toBe("variant");
    expect(node.discriminator).toBe("kind");
    expect(node.options?.map((o) => o.value)).toEqual(["a", "b"]);
    expect(fieldsOf(node, { kind: "b" }).map((f) => f.key)).toEqual(["kind", "y"]);
    expect(fieldsOf(node, { kind: "zzz" })).toEqual([]);
    expect(fieldsOf(node, {})).toEqual([]);
    expect(fieldsOf(node, null)).toEqual([]);
  });

  it("falls back to JSON for what has no field (any, lazy shapes)", () => {
    const node = describeSchema(z.object({ blob: z.unknown(), mixed: z.union([z.string(), z.number()]) }));
    expect(child(node, "blob").kind).toBe("json");
    expect(child(node, "mixed").kind).toBe("json");
  });

  it("an optional intersection arm keeps both sides", () => {
    const base = z.object({ id: z.string() });
    const node = describeSchema(
      base.and(
        z.discriminatedUnion("category", [
          z.object({ category: z.literal("x"), v: z.number() }),
          z.object({ category: z.literal("y"), w: z.string() }),
        ]),
      ),
    );
    expect(node.kind).toBe("variant");
    expect(fieldsOf(node, { category: "y" }).map((f) => f.key)).toEqual(["id", "category", "w"]);
  });

  it("a preprocessed field takes the shape of its output", () => {
    const node = describeSchema(z.object({ n: z.preprocess((v) => v, z.number().int()) }));
    expect(child(node, "n").kind).toBe("integer");
  });
});

describe("describeSchema: the catalog contracts of WP-03", () => {
  it("builds the GPU form from the draft schema: every value may be unknown", () => {
    const node = describeSchema(NULLABLE_SPEC_SCHEMAS.gpu);
    expect(node.children?.map((c) => c.key)).toEqual([
      "chip",
      "vramGb",
      "lengthMm",
      "heightMm",
      "slots",
      "power",
      "adapterInBox",
      "tgpW",
      "vendorRecommendedPsuW",
      "hwEncoders",
    ]);
    for (const c of node.children ?? []) expect(c.nullable).toBe(true);
    expect(child(node, "vramGb")).toMatchObject({ kind: "integer", min: 1 });
    expect(child(node, "slots")).toMatchObject({ kind: "number" });
    expect(child(node, "adapterInBox").kind).toBe("boolean");
    expect(child(node, "power").item?.children?.map((c) => c.key)).toEqual(["conn", "count"]);
    expect(child(node, "hwEncoders").kind).toBe("list");
  });

  it("builds the complete GPU schema with required fields", () => {
    const node = describeSchema(GpuSpecsSchema);
    expect(child(node, "chip")).toMatchObject({ nullable: false, optional: false });
  });

  it("keeps the CPU memory limits as one number per memory type", () => {
    const node = describeSchema(CpuSpecsSchema);
    expect(child(node, "memTypes").kind).toBe("multiselect");
    expect(child(node, "memMaxMts")).toMatchObject({ kind: "record" });
    expect(child(node, "minBiosByChipset")).toMatchObject({ kind: "json", optional: true });
  });

  it("describes ProductSpecs as a variant with one arm per category", () => {
    const node = describeSchema(ProductSpecsSchema);
    expect(node.kind).toBe("variant");
    expect(node.discriminator).toBe("category");
    expect(Object.keys(node.arms ?? {})).toEqual(
      expect.arrayContaining(["cpu", "gpu", "chair", "keyboard", "os_license"]),
    );
    expect(Object.keys(node.arms ?? {})).toHaveLength(29);
    const gpuSpec = findNode(node, ["spec", "vramGb"], { category: "gpu" });
    expect(gpuSpec?.kind).toBe("integer");
  });

  it("describes the base fields of a product", () => {
    const node = describeSchema(ProductBaseSchema);
    expect(child(node, "color")).toMatchObject({ kind: "select" });
    expect(child(node, "returnable").kind).toBe("boolean");
  });
});

describe("humanize", () => {
  it("makes a readable fallback label from a key", () => {
    expect(humanize("vramGb")).toBe("Vram gb");
    expect(humanize("hw_encoders")).toBe("Hw encoders");
  });
});
