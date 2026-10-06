// createNodeTranslator must behave the same in plain Node (bot, worker) as under Vitest, which loads use-intl with the
// "development" condition. The production build of use-intl returns a raw ICU template when no values are passed.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createNodeTranslator } from "./node-translator.ts";

const pkgDir = fileURLToPath(new URL("..", import.meta.url));

function runInPlainNode(body: string): { status: number | null; stdout: string; stderr: string } {
  const script = `
    import { createNodeTranslator } from "./src/node-translator.ts";
    const messages = {
      demo: {
        hi: "Salom, {name}!",
        items: "{count, plural, one {# ta mahsulot} other {# ta mahsulot}}",
        plain: "Salom",
      },
    };
    const t = createNodeTranslator("uz", "demo", messages);
    ${body}
  `;
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.VITEST;
  const r = spawnSync(process.execPath, ["--input-type=module", "--no-warnings", "-e", script], {
    cwd: pkgDir,
    env,
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("createNodeTranslator in plain Node (production build of use-intl)", () => {
  it("throws when a message with an argument is called without values", () => {
    const r = runInPlainNode(`try { console.log("RESULT:" + t("hi")); } catch { console.log("THROWN"); }`);
    expect(r.stdout, r.stderr).toContain("THROWN");
    expect(r.stdout).not.toContain("RESULT:");
  });

  it("throws for a plural message called without values", () => {
    const r = runInPlainNode(`try { console.log("RESULT:" + t("items")); } catch { console.log("THROWN"); }`);
    expect(r.stdout, r.stderr).toContain("THROWN");
  });

  it("throws when values are given but the argument is absent", () => {
    const r = runInPlainNode(`try { console.log("RESULT:" + t("hi", {})); } catch { console.log("THROWN"); }`);
    expect(r.stdout, r.stderr).toContain("THROWN");
  });

  it("still renders a message without arguments and a message with its arguments", () => {
    const r = runInPlainNode(
      `console.log(t("plain") + "|" + t("hi", { name: "Aziz" }) + "|" + t("items", { count: 2 }));`,
    );
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe("Salom|Salom, Aziz!|2 ta mahsulot");
  });
});

describe("createNodeTranslator values", () => {
  const t = createNodeTranslator("uz", "demo", {
    demo: { hi: "Salom, {name}!", items: "{count, plural, other {# ta}}" },
  });

  it("rejects undefined and null values instead of printing an empty text", () => {
    expect(() => t("hi", { name: undefined as never })).toThrow(/name/);
    expect(() => t("hi", { name: null as never })).toThrow(/name/);
  });

  it("rejects a non-numeric count instead of printing «son emas»", () => {
    expect(() => t("items", { count: undefined as never })).toThrow(/count/);
    expect(() => t("items", { count: Number.NaN })).toThrow(/count/);
  });
});
