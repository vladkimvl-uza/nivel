import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { checkNamespace, placeholders } from "../check-messages.mjs";
import { checkNodeVersion } from "../check-node.mjs";
import { checkPorts, isPortFree, slotPorts } from "../check-ports.mjs";
import { globToRegExp } from "../lib/files.mjs";

describe("check-node", () => {
  it("fails on the global Node 25 and passes on 24", () => {
    expect(checkNodeVersion("25.9.0", "24.21.0").ok).toBe(false);
    expect(checkNodeVersion("24.21.0", "24.21.0")).toEqual({ ok: true, message: "Node 24.21.0 OK" });
    expect(checkNodeVersion("22.12.0", "24.21.0").ok).toBe(false);
  });
});

describe("check-ports", () => {
  it("derives ports from the slot", () => {
    expect(slotPorts(1).map((p) => p.port)).toEqual([3200, 3201, 3202, 3203]);
  });

  it("detects a busy port", async () => {
    const server = createServer();
    await new Promise((r) => server.listen(0, r));
    const { port } = server.address();
    expect(await isPortFree(port)).toBe(false);
    await new Promise((r) => server.close(r));
    expect(await isPortFree(port)).toBe(true);
    expect(Array.isArray(await checkPorts(9))).toBe(true);
  });
});

describe("check-messages", () => {
  it("compares keys and ICU placeholders", () => {
    expect(placeholders("{count, plural, one {# sum} other {# sum}} {name}")).toEqual(["count", "name"]);
    const meta = { "a.b": { maxLen: 10 }, "a.c": { maxLen: 5 } };
    const problems = checkNamespace("site", { a: { b: "Salom {name}", c: "uzoq matn" } }, { a: { b: "Привет" } }, meta);
    expect(problems).toContain('site: key "a.c" missing in ru');
    expect(problems.join()).toContain("placeholders differ");
    expect(problems.join()).toContain("maxLen 5");
  });
});

describe("globs", () => {
  it("keeps Next.js folder names literal", () => {
    expect(
      globToRegExp("apps/web/app/[locale]/(marketing)/**").test("apps/web/app/[locale]/(marketing)/page.tsx"),
    ).toBe(true);
    expect(globToRegExp("apps/web/app/[locale]/(marketing)/**").test("apps/web/app/l/(marketing)/page.tsx")).toBe(
      false,
    );
    expect(globToRegExp("packages/domain/src/**/types.ts").test("packages/domain/src/types.ts")).toBe(true);
    expect(globToRegExp("apps/worker/src/{main.ts,queues}/**").test("apps/worker/src/main.ts")).toBe(true);
  });
});
