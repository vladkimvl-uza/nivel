import { describe, expect, it } from "vitest";
import { loadMessages } from "./site-messages.ts";

/** Dotted keys of the leaves of a message tree. */
function leaves(tree: unknown, prefix = ""): string[] {
  if (typeof tree !== "object" || tree === null) return [];
  return Object.entries(tree).flatMap(([k, v]) =>
    typeof v === "string" ? [`${prefix}${k}`] : leaves(v, `${prefix}${k}.`),
  );
}

describe("loadMessages", () => {
  it("gives the common and the site namespaces of each language", () => {
    for (const locale of ["uz", "ru"] as const) {
      const m = loadMessages(locale);
      expect(Object.keys(m)).toEqual(expect.arrayContaining(["common", "site"]));
    }
  });

  it("has the same keys in Uzbek and in Russian", () => {
    const keys = (l: "uz" | "ru") => leaves(loadMessages(l).site).sort();
    expect(keys("uz")).toEqual(keys("ru"));
    expect(keys("uz").length).toBeGreaterThan(300);
  });

  it("writes Uzbek in the Latin script: the headline of the page", () => {
    expect(JSON.stringify(loadMessages("uz").site)).toContain("Vazifangizga mos ish joyi");
    expect(JSON.stringify(loadMessages("ru").site)).toContain("Рабочее место под вашу задачу");
  });
});
