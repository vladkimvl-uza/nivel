import { describe, expect, it } from "vitest";
import { checkNamespace, flattenMessages } from "./messages-check.ts";

const meta = (maxLen = 50) => ({ context: "ctx", maxLen, status: "draft" as const });

describe("flattenMessages", () => {
  it("flattens nested objects to dotted keys in source order", () => {
    expect(flattenMessages({ a: { b: "1", c: { d: "2" } }, e: "3" })).toEqual([
      ["a.b", "1"],
      ["a.c.d", "2"],
      ["e", "3"],
    ]);
  });
});

describe("checkNamespace", () => {
  it("passes a consistent namespace", () => {
    const uz = { a: { b: "Salom {name}" }, c: "Matn" };
    const ru = { a: { b: "Привет {name}" }, c: "Текст" };
    expect(checkNamespace("site", uz, ru, { "a.b": meta(), c: meta() })).toEqual([]);
  });

  it("reports keys missing in either language", () => {
    const problems = checkNamespace(
      "site",
      { a: "x", b: "y" },
      { a: "x", c: "z" },
      { a: meta(), b: meta(), c: meta() },
    );
    expect(problems).toContain('site: key "b" missing in ru');
    expect(problems).toContain('site: key "c" missing in uz');
  });

  it("requires a meta entry for every key", () => {
    expect(checkNamespace("site", { a: "x" }, { a: "x" }, {})).toContain(
      'site: key "a" has no meta entry (context, maxLen, status)',
    );
  });

  it("reports meta entries without messages (stale keys)", () => {
    expect(checkNamespace("site", { a: "x" }, { a: "x" }, { a: meta(), gone: meta() })).toContain(
      'site: meta entry "gone" has no message in uz and ru',
    );
  });

  it("validates the meta shape: context, positive integer maxLen, status", () => {
    const bad = (m: unknown) => checkNamespace("site", { a: "x" }, { a: "x" }, { a: m as never }).join("\n");
    expect(bad({ context: "", maxLen: 10, status: "draft" })).toContain('meta "a": context must be a non-empty string');
    expect(bad({ context: "c", maxLen: 0, status: "draft" })).toContain('meta "a": maxLen must be a positive integer');
    expect(bad({ context: "c", maxLen: 1.5, status: "draft" })).toContain(
      'meta "a": maxLen must be a positive integer',
    );
    expect(bad({ context: "c", maxLen: 10, status: "final" })).toContain('meta "a": status must be draft or reviewed');
    expect(bad({ context: "c", maxLen: 10, status: "reviewed", screenshot: 5 })).toContain(
      'meta "a": screenshot must be a string',
    );
  });

  it("compares ICU placeholders including their types", () => {
    const names = checkNamespace("s", { a: "Salom {name}" }, { a: "Привет" }, { a: meta() }).join("\n");
    expect(names).toContain('key "a" placeholders differ');
    const types = checkNamespace("s", { a: "{n, number} ta" }, { a: "{n} шт." }, { a: meta() }).join("\n");
    expect(types).toContain('key "a" placeholders differ');
  });

  it("accepts different plural categories in uz and ru", () => {
    const uz = { a: "{n, plural, one {# ta} other {# ta}}" };
    const ru = { a: "{n, plural, one {# шт.} few {# шт.} many {# шт.} other {# шт.}}" };
    expect(checkNamespace("s", uz, ru, { a: meta(100) })).toEqual([]);
  });

  it("enforces maxLen from meta in both languages", () => {
    expect(checkNamespace("s", { a: "uzoq matn" }, { a: "ok" }, { a: meta(5) })).toEqual(['s: uz "a" is 9 > maxLen 5']);
    expect(checkNamespace("s", { a: "ok" }, { a: "очень длинный" }, { a: meta(5) })).toEqual([
      's: ru "a" is 13 > maxLen 5',
    ]);
  });

  it("allows text exactly at the limit", () => {
    expect(checkNamespace("s", { a: "12345" }, { a: "12345" }, { a: meta(5) })).toEqual([]);
  });

  it("rejects dollars and USD: prices are in sums only", () => {
    const p = checkNamespace("s", { a: "100 $" }, { a: "100 USD" }, { a: meta() }).join("\n");
    expect(p).toContain('uz "a" mentions dollars');
    expect(p).toContain('ru "a" mentions dollars');
  });

  it("rejects empty messages", () => {
    const p = checkNamespace("s", { a: "" }, { a: "  " }, { a: meta() }).join("\n");
    expect(p).toContain('uz "a" is empty');
    expect(p).toContain('ru "a" is empty');
  });

  it("rejects broken ICU syntax", () => {
    expect(checkNamespace("s", { a: "Salom {name" }, { a: "Привет {name" }, { a: meta() }).join("\n")).toContain(
      'uz "a" is not valid ICU',
    );
  });

  it("rejects non-string leaves and dots inside key names", () => {
    expect(checkNamespace("s", { a: 5 as never }, { a: 5 as never }, { a: meta() }).join("\n")).toContain(
      'key "a" must be a string',
    );
    expect(checkNamespace("s", { "a.b": "x" }, { "a.b": "x" }, {}).join("\n")).toContain(
      'key segment "a.b" must not contain a dot',
    );
    expect(checkNamespace("s", { a: ["x"] as never }, { a: ["x"] as never }, {}).join("\n")).toContain(
      'key "a" must be a string',
    );
  });

  it("works without any meta object", () => {
    expect(checkNamespace("s", { a: "x" }, { a: "y" }, undefined)).toContain(
      's: key "a" has no meta entry (context, maxLen, status)',
    );
  });
});
