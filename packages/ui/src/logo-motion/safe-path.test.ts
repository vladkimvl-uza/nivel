import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { insideRoot } from "../../scripts/safe-path.mjs";

const root = resolve("/work/packages/ui");

describe("insideRoot (the local server of the clip script)", () => {
  it("gives the absolute path of a file inside the root", () => {
    expect(insideRoot(root, "src/logo-motion/create.ts")).toBe(join(root, "src", "logo-motion", "create.ts"));
    expect(insideRoot(root, "./a/../b.ts")).toBe(join(root, "b.ts"));
  });

  it("refuses a way out through .. (plain and decoded from %2f)", () => {
    expect(() => insideRoot(root, "../../etc/passwd")).toThrow(/outside/);
    expect(() => insideRoot(root, "a/../../x")).toThrow(/outside/);
    expect(() => insideRoot(root, decodeURIComponent("..%2f..%2fdocs/x"))).toThrow(/outside/);
  });

  it("refuses a sibling folder whose name starts like the root (the startsWith hole)", () => {
    expect(() => insideRoot(root, decodeURIComponent("..%2fui-secret/x.txt"))).toThrow(/outside/);
    expect(() => insideRoot(root, "../ui2/.env")).toThrow(/outside/);
  });

  it("refuses the root itself (a folder is not a file)", () => {
    expect(() => insideRoot(root, "")).toThrow(/outside/);
    expect(() => insideRoot(root, "a/..")).toThrow(/outside/);
  });
});
