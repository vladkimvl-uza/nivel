// The real catalogs of this repository must satisfy the same rules the CI applies (acceptance of WP-08).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sampleValues } from "./icu.ts";
import { namespaces } from "./index.ts";
import { checkNamespace, flattenMessages } from "./messages-check.ts";
import { createNodeTranslator } from "./node-translator.ts";
import { checkUzString } from "./uz-apostrophes.ts";

const base = fileURLToPath(new URL("../messages/", import.meta.url));
const read = (kind: string, file: string) => JSON.parse(readFileSync(join(base, kind, file), "utf8"));
const files = readdirSync(join(base, "uz")).filter((f) => f.endsWith(".json"));
const onDisk = files.map((f) => f.replace(/\.json$/, "")).sort();

describe("messages of the repository", () => {
  it("every registered namespace has its uz, ru and meta files", () => {
    for (const ns of namespaces) {
      for (const kind of ["uz", "ru", "meta"]) {
        expect(readdirSync(join(base, kind)), `${kind}/${ns}.json`).toContain(`${ns}.json`);
      }
    }
  });

  // Namespaces of other work packages arrive as files first; catalog.ts (owned by WP-08) learns about them at integration.
  // Until then this is a warning, so that a package branch is not forced to edit a file it does not own. The integrator runs
  // the suite with NIVEL_STRICT_NAMESPACES=1 after registering them.
  it("every namespace file on disk is registered in the catalog", () => {
    const missing = onDisk.filter((ns) => !(namespaces as readonly string[]).includes(ns));
    if (missing.length === 0) return;
    if (process.env.NIVEL_STRICT_NAMESPACES === "1") {
      expect(missing, "register in packages/i18n/src/catalog.ts").toEqual([]);
    } else {
      console.warn(`namespaces not registered in packages/i18n/src/catalog.ts yet: ${missing.join(", ")}`);
    }
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
    const ns = file.replace(/\.json$/, "");
    for (const locale of ["uz", "ru"] as const) {
      // The files of the repository are read directly, so that a namespace that is not registered yet is still checked.
      const t = createNodeTranslator(locale, ns, { [ns]: read(locale, file) });
      for (const [key, text] of flattenMessages(read(locale, file))) {
        if (/<\/?[A-Za-z]/.test(text)) continue; // markup needs rich-text functions; its syntax is checked by check-messages
        expect(() => t(key, sampleValues(text)), `${locale} ${ns}.${key}`).not.toThrow();
      }
    }
  });
});
