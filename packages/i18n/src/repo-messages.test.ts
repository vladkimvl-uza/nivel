// The real catalogs of this repository must satisfy the same rules the CI applies (acceptance of WP-08).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { namespaces } from "./index.ts";
import { checkNamespace, flattenMessages } from "./messages-check.ts";
import { createNodeTranslator } from "./node-translator.ts";
import { checkUzString } from "./uz-apostrophes.ts";

const base = fileURLToPath(new URL("../messages/", import.meta.url));
const read = (kind: string, file: string) => JSON.parse(readFileSync(join(base, kind, file), "utf8"));
const files = readdirSync(join(base, "uz")).filter((f) => f.endsWith(".json"));

describe("messages of the repository", () => {
  it("every namespace file on disk is registered in the catalog (and the other way round)", () => {
    expect(files.map((f) => f.replace(/\.json$/, "")).sort()).toEqual([...namespaces].sort());
  });

  it.each(files)("%s: uz, ru and meta are consistent (keys, placeholders, limits)", (file) => {
    const ns = file.replace(/\.json$/, "");
    expect(checkNamespace(ns, read("uz", file), read("ru", file), read("meta", file))).toEqual([]);
  });

  it.each(files)("%s: Uzbek text has correct apostrophes", (file) => {
    const problems = flattenMessages(read("uz", file)).flatMap(([k, v]) => checkUzString(`${file} ${k}`, v));
    expect(problems).toEqual([]);
  });

  it.each(files)("%s: every message formats in both locales through use-intl", (file) => {
    const ns = file.replace(/\.json$/, "") as (typeof namespaces)[number];
    const args = { count: 2, name: "Aziz", n: 3 };
    for (const locale of ["uz", "ru"] as const) {
      const t = createNodeTranslator(locale, ns);
      for (const [key] of flattenMessages(read(locale, file))) {
        expect(() => t(key, args), `${locale} ${ns}.${key}`).not.toThrow();
      }
    }
  });
});
