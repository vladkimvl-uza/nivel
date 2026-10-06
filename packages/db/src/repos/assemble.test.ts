import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// packages/db/sql is the source of the hand-written part of the migrations (triggers, views, functions, grants);
// assemble.mjs joins it into the custom migration. The migration must always be what the sources say.
const ASSEMBLE = "../../sql/assemble.mjs";
const { assemble, assembleChange, assembleFor, changeNames, sqlFiles, MODULE_ORDER } = (await import(
  /* @vite-ignore */ ASSEMBLE
)) as {
  assemble(dir?: string): string;
  assembleChange(name: string, dir?: string): string;
  assembleFor(migrationFile: string, dir?: string): string;
  changeNames(dir?: string): string[];
  sqlFiles(dir?: string): string[];
  MODULE_ORDER: string[];
};
const MIGRATIONS = fileURLToPath(new URL("../../migrations/", import.meta.url));

describe("sql/assemble.mjs", () => {
  it("takes every file of every listed module, in module order and then by name", () => {
    const files = sqlFiles().map((f) => f.split("\\").join("/").split("/sql/")[1] ?? "");
    expect(files.length).toBeGreaterThanOrEqual(9);
    const modules = files.map((f) => f.split("/")[0] ?? "");
    expect(modules).toEqual([...modules].sort((a, b) => MODULE_ORDER.indexOf(a) - MODULE_ORDER.indexOf(b)));
    expect(files[0]?.startsWith("ops/")).toBe(true);
    expect(files.at(-1)).toBe("roles/00_grants.sql");
  });

  it("matches the custom migration of the package: sql/ was not changed without regenerating it", () => {
    const name = readdirSync(MIGRATIONS).find((n) => n.endsWith("_wp06_sql.sql"));
    expect(name, "the custom migration *_wp06_sql.sql").toBeDefined();
    const migration = readFileSync(join(MIGRATIONS, name ?? ""), "utf8")
      .split("\r\n")
      .join("\n");
    expect(migration, `run: node packages/db/sql/assemble.mjs packages/db/migrations/${name}`).toBe(assemble());
  });

  it("leaves the changes directory out of the base: the base is the migration that was applied", () => {
    const dir = mkdtempSync(join(tmpdir(), "nivel-sql-"));
    mkdirSync(join(dir, "ops"));
    mkdirSync(join(dir, "changes"));
    writeFileSync(join(dir, "ops", "00_a.sql"), "SELECT 1;");
    writeFileSync(join(dir, "changes", "wp99_next.sql"), "SELECT 2;");
    expect(sqlFiles(dir)).toHaveLength(1);
    expect(assemble(dir)).toBe("SELECT 1;\n");
  });

  it("refuses a module directory that is not in MODULE_ORDER", () => {
    const dir = mkdtempSync(join(tmpdir(), "nivel-sql-"));
    mkdirSync(join(dir, "ops"));
    writeFileSync(join(dir, "ops", "00_a.sql"), "SELECT 1;");
    expect(sqlFiles(dir)).toHaveLength(1);
    mkdirSync(join(dir, "newmodule"));
    expect(() => sqlFiles(dir)).toThrow(/newmodule/);
  });

  it("keeps one source file for every later migration, and each migration is what its source says", () => {
    const names = changeNames();
    expect(names.length).toBeGreaterThanOrEqual(1);
    const migrations = readdirSync(MIGRATIONS);
    for (const name of names) {
      const file = migrations.find((n) => n.endsWith(`_${name}.sql`));
      expect(file, `the migration *_${name}.sql of the change ${name}`).toBeDefined();
      const body = readFileSync(join(MIGRATIONS, file ?? ""), "utf8")
        .split("\r\n")
        .join("\n");
      expect(body, `run: node packages/db/sql/assemble.mjs packages/db/migrations/${file}`).toBe(assembleChange(name));
      expect(assembleFor(file ?? "")).toBe(assembleChange(name));
    }
  });

  it("picks the base for the base migration and the change file for any other name", () => {
    const dir = mkdtempSync(join(tmpdir(), "nivel-sql-"));
    mkdirSync(join(dir, "ops"));
    mkdirSync(join(dir, "changes"));
    writeFileSync(join(dir, "ops", "00_a.sql"), "SELECT 1;");
    writeFileSync(join(dir, "changes", "wp99_next.sql"), "SELECT 2;\r\n--> statement-breakpoint\r\nSELECT 3;\r\n");
    expect(assembleFor("20261006053326_wp06_sql.sql", dir)).toBe("SELECT 1;\n");
    expect(assembleFor("20261007100000_wp99_next.sql", dir)).toBe("SELECT 2;\n--> statement-breakpoint\nSELECT 3;\n");
    expect(changeNames(dir)).toEqual(["wp99_next"]);
    expect(() => assembleFor("20261007100000_wp98_missing.sql", dir)).toThrow(/wp98_missing/);
    expect(() => assembleFor("not-a-migration.sql", dir)).toThrow(/not-a-migration/);
  });

  it("has no changes directory in a tree that never had one", () => {
    const dir = mkdtempSync(join(tmpdir(), "nivel-sql-"));
    expect(changeNames(dir)).toEqual([]);
  });

  it("skips a module without a directory and joins files with the statement marker", () => {
    const dir = mkdtempSync(join(tmpdir(), "nivel-sql-"));
    mkdirSync(join(dir, "ops"));
    mkdirSync(join(dir, "roles"));
    writeFileSync(join(dir, "ops", "00_a.sql"), "SELECT 1;\r\n");
    writeFileSync(join(dir, "roles", "00_b.sql"), "SELECT 2;\n");
    expect(assemble(dir)).toBe("SELECT 1;\n--> statement-breakpoint\nSELECT 2;\n");
  });

  it("does not hide a directory it cannot read", () => {
    const dir = mkdtempSync(join(tmpdir(), "nivel-sql-"));
    writeFileSync(join(dir, "ops"), "a file where the module directory should be");
    expect(() => sqlFiles(dir)).toThrow();
  });
});
