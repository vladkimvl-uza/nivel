import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkDeps } from "../check-deps.mjs";

let root;
const write = (rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const pkg = (dir, name, deps = {}) => write(`${dir}/package.json`, JSON.stringify({ name, dependencies: deps }));

function fixture() {
  root = mkdtempSync(join(tmpdir(), "nivel-deps-"));
  pkg("packages/domain", "@nivel/domain");
  pkg("packages/db", "@nivel/db", { "@nivel/domain": "workspace:*" });
  pkg("apps/web", "@nivel/web", { "@nivel/domain": "workspace:*" });
  write("apps/web/app/page.tsx", 'import { sum } from "@nivel/domain/money";\nexport default sum;\n');
  write("packages/domain/src/money/index.ts", "export const sum = 1;\n");
  write("packages/db/src/index.ts", 'import type { Sum } from "@nivel/domain/money";\n');
}

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("check-deps", () => {
  it("passes a clean graph", () => {
    fixture();
    expect(checkDeps(root)).toEqual([]);
  });

  it("catches an import of apps/web from packages/domain", () => {
    fixture();
    write(
      "packages/domain/src/money/bad.ts",
      'import page from "../../../../apps/web/app/page.tsx";\nexport { page };\n',
    );
    write("packages/domain/src/money/bad2.ts", 'export { default } from "@nivel/web/app/page";\n');
    const v = checkDeps(root);
    expect(v.some((x) => x.includes("packages/domain/src/money/bad.ts") && x.includes("apps/web"))).toBe(true);
    expect(v.some((x) => x.includes("packages/domain/src/money/bad2.ts"))).toBe(true);
  });

  it("catches reverse edges and undeclared dependencies", () => {
    fixture();
    pkg("packages/domain", "@nivel/domain", { "@nivel/db": "workspace:*" });
    write("packages/db/src/x.ts", 'import { a } from "@nivel/services";\n');
    const v = checkDeps(root).join("\n");
    expect(v).toContain("packages/domain: dependency @nivel/db is not allowed");
    expect(v).toContain("packages/domain: must have zero runtime dependencies");
    expect(v).toContain("imports @nivel/services");
  });

  it("forbids app-to-app imports", () => {
    fixture();
    pkg("apps/admin", "@nivel/admin", { "@nivel/web": "workspace:*" });
    expect(checkDeps(root).join("\n")).toContain("apps/admin: depends on app @nivel/web");
  });
});
