// packages/testing/fixtures/wp-03/default-specs.json is read by the zod schema tests in @nivel/contracts.
// This test keeps it identical to the complete specs the compat tests are written against, so a schema that accepts
// the fixture accepts the data the rules were verified with.
import { describe, expect, it } from "vitest";
import { DETAILED_CATEGORIES } from "../catalog/index.ts";
import { defaultSpec } from "./testkit.ts";

const files = import.meta.glob("../../../testing/fixtures/wp-03/default-specs.json", {
  eager: true,
  query: "?raw",
  import: "default",
});

describe("default-specs.json", () => {
  const fixture = JSON.parse(Object.values(files)[0] ?? "{}") as Record<string, unknown>;

  it("has an entry for each of the 14 typed categories and nothing else", () => {
    expect(Object.keys(fixture).sort()).toEqual([...DETAILED_CATEGORIES].sort());
  });

  it.each([...DETAILED_CATEGORIES])("%s equals the test kit default", (category) => {
    expect(fixture[category]).toEqual(defaultSpec(category));
  });
});
