import { describe, expect, it } from "vitest";
import { makePlain, makeProduct, pid } from "../compat/testkit.ts";
import { createCatalogLookup, DETAILED_CATEGORIES, specOf } from "./index.ts";

describe("createCatalogLookup", () => {
  const cpu = makeProduct("cpu", "cpu-1");
  const cpu2 = makeProduct("cpu", "cpu-2");
  const gpu = makeProduct("gpu", "gpu-1");
  const lookup = createCatalogLookup([cpu, gpu, cpu2]);

  it("finds a product by id and returns undefined for an unknown id", () => {
    expect(lookup.get(pid("cpu-1"))).toBe(cpu);
    expect(lookup.get(pid("nope"))).toBeUndefined();
  });

  it("lists products of a category in input order", () => {
    expect(lookup.byCategory("cpu")).toEqual([cpu, cpu2]);
    expect(lookup.byCategory("gpu")).toEqual([gpu]);
  });

  it("returns an empty list for a category without products", () => {
    expect(lookup.byCategory("psu")).toEqual([]);
  });

  it("works on an empty catalog", () => {
    const empty = createCatalogLookup([]);
    expect(empty.get(pid("x"))).toBeUndefined();
    expect(empty.byCategory("cpu")).toEqual([]);
  });

  it("rejects duplicate ids: two rows must never share an identity", () => {
    expect(() => createCatalogLookup([cpu, makeProduct("cpu", "cpu-1")])).toThrow(RangeError);
  });

  it("does not expose its internal arrays to mutation of the input", () => {
    const input = [cpu];
    const l = createCatalogLookup(input);
    input.push(gpu);
    expect(l.get(pid("gpu-1"))).toBeUndefined();
  });
});

describe("specOf", () => {
  it("returns the typed spec for a matching category", () => {
    const spec = specOf(makeProduct("cpu", "c", { socket: "AM4" }), "cpu");
    expect(spec?.socket).toBe("AM4");
  });

  it("returns undefined when the product belongs to another category", () => {
    expect(specOf(makeProduct("gpu", "g"), "cpu")).toBeUndefined();
  });

  it("returns undefined for categories without typed specs", () => {
    expect(specOf(makePlain("keyboard", "k"), "cpu")).toBeUndefined();
  });

  it("keeps null values as null (unknown), not as defaults", () => {
    expect(specOf(makeProduct("psu", "p", { watts: null }), "psu")?.watts).toBeNull();
  });
});

describe("DETAILED_CATEGORIES", () => {
  it("lists the 14 categories that carry typed specs (ARCHITECTURE 4.3)", () => {
    expect([...DETAILED_CATEGORIES].sort()).toEqual([
      "aio",
      "arm",
      "case",
      "chair",
      "cooler_air",
      "cpu",
      "desk",
      "fan",
      "gpu",
      "mb",
      "monitor",
      "psu",
      "ram",
      "ssd",
    ]);
  });
});
