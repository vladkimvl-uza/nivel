// Command-line logic of tools/i18n-export.mjs, tools/i18n-import.mjs and tools/uz-new-latin.mjs. Plain functions that
// return the exit code (0 ok, 1 problems found, 2 wrong usage), so that tests run them in-process.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { type ParseArgsOptionsConfig, parseArgs } from "node:util";
import { formatDate } from "./format.ts";
import { flattenMessages, type MessageTree } from "./messages-check.ts";
import { toNewLatinMessages } from "./new-latin.ts";
import { buildExportSheets, importTranslations, readCatalog, readGlossary, readJsonFile } from "./translator-flow.ts";
import { writeXlsx } from "./xlsx.ts";

export interface CliIo {
  log(message: string): void;
  error(message: string): void;
}

const USAGE = {
  export: "usage: i18n-export [--out <file.xlsx>] [--ns a,b] [--root <dir>]",
  import: "usage: i18n-import <file.xlsx> [--dry-run] [--normalize] [--ns a,b] [--root <dir>]",
  newLatin: "usage: uz-new-latin [--out <dir>] [--exceptions <words.json>] [--root <dir>]",
};

function parse<const O extends ParseArgsOptionsConfig>(argv: readonly string[], options: O, usage: string, io: CliIo) {
  try {
    return parseArgs({ args: [...argv], options, allowPositionals: true, strict: true });
  } catch (e) {
    io.error(`${(e as Error).message}
${usage}`);
    return null;
  }
}

const list = (value: string | undefined) =>
  value
    ? value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

/** `i18n-export`: writes the translator workbook. */
export function runExport(argv: readonly string[], io: CliIo, env: { now?: Date } = {}): number {
  const parsed = parse(
    argv,
    { out: { type: "string" }, ns: { type: "string" }, root: { type: "string" } },
    USAGE.export,
    io,
  );
  if (!parsed) return 2;
  const root = resolve(parsed.values.root ?? process.cwd());
  try {
    const catalog = readCatalog(root, list(parsed.values.ns));
    const sheets = buildExportSheets(catalog, readGlossary(root));
    const [d, m, y] = formatDate(env.now ?? new Date(), "uz").split(".");
    const out = resolve(parsed.values.out ?? join(root, ".data", "i18n", `nivel-translations-${y}-${m}-${d}.xlsx`));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, writeXlsx(sheets));
    const keys = (sheets[0]?.rows.length ?? 1) - 1;
    io.log(`wrote ${out}`);
    io.log(`${keys} keys in ${Object.keys(catalog).length} namespaces`);
    return 0;
  } catch (e) {
    io.error(`i18n-export: ${(e as Error).message}\n${USAGE.export}`);
    return 2;
  }
}

export interface ImportDeps {
  /** normalizeUz of packages/domain (WP-02); needed for --normalize. */
  normalizeUz?: (input: string) => string;
}

/** `i18n-import`: checks a workbook and writes the Uzbek texts. */
export function runImport(argv: readonly string[], io: CliIo, deps: ImportDeps = {}): number {
  const parsed = parse(
    argv,
    {
      "dry-run": { type: "boolean" },
      normalize: { type: "boolean" },
      ns: { type: "string" },
      root: { type: "string" },
    },
    USAGE.import,
    io,
  );
  if (!parsed) return 2;
  const [file] = parsed.positionals;
  if (!file || parsed.positionals.length > 1) {
    io.error(USAGE.import);
    return 2;
  }
  if (!existsSync(file)) {
    io.error(`i18n-import: cannot read ${file}\n${USAGE.import}`);
    return 2;
  }
  let normalize: ((s: string) => string) | undefined;
  if (parsed.values.normalize) {
    try {
      if (!deps.normalizeUz) throw new Error("no implementation given");
      deps.normalizeUz("o'zbek");
      normalize = deps.normalizeUz;
    } catch (e) {
      io.error(`i18n-import: normalizeUz is not available yet (${(e as Error).message}); run without --normalize`);
      return 2;
    }
  }
  const root = resolve(parsed.values.root ?? process.cwd());
  const namespaces = list(parsed.values.ns);
  let report: ReturnType<typeof importTranslations>;
  try {
    report = importTranslations(root, readFileSync(file), {
      dryRun: parsed.values["dry-run"] ?? false,
      ...(namespaces ? { namespaces } : {}),
      ...(normalize ? { normalize } : {}),
    });
  } catch (e) {
    io.error(`i18n-import: ${(e as Error).message}`);
    return 2;
  }
  for (const w of report.warnings) io.error(`warning: ${w}`);
  for (const e of report.errors) io.error(`error: ${e}`);
  if (!report.ok) {
    io.error(`i18n-import: ${report.errors.length} error(s); nothing was written`);
    return 1;
  }
  for (const f of report.written) io.log(`wrote ${f}`);
  io.log(
    `${report.changes.length} changed, ${report.unchanged} unchanged, ${report.missing} not in the file${parsed.values["dry-run"] ? " (dry run: nothing written)" : ""}`,
  );
  return 0;
}

/** True when `child` is `parent` or lies under it. Windows paths ignore letter case, so they are compared in lower case. */
function isInside(parent: string, child: string): boolean {
  const fold = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);
  const rel = relative(fold(parent), fold(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function readExceptions(path: string): string[] {
  const data: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(data) || data.some((w) => typeof w !== "string"))
    throw new Error("the exception list must be a JSON array of words");
  return data as string[];
}

/** `uz-new-latin`: converts Uzbek messages to the new alphabet into a separate folder (a dry run without --out). */
export function runNewLatin(argv: readonly string[], io: CliIo): number {
  const parsed = parse(
    argv,
    { out: { type: "string" }, exceptions: { type: "string" }, root: { type: "string" } },
    USAGE.newLatin,
    io,
  );
  if (!parsed) return 2;
  const root = resolve(parsed.values.root ?? process.cwd());
  const messages = join(root, "packages", "i18n", "messages");
  const out = parsed.values.out ? resolve(parsed.values.out) : null;
  if (out && isInside(messages, out)) {
    io.error(`uz-new-latin: refusing to write inside the messages folder (${messages}); choose another --out`);
    return 2;
  }
  let exceptions: string[] = [];
  try {
    if (parsed.values.exceptions) exceptions = readExceptions(resolve(parsed.values.exceptions));
  } catch (e) {
    io.error(`uz-new-latin: ${(e as Error).message}\n${USAGE.newLatin}`);
    return 2;
  }
  const dir = join(messages, "uz");
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort()
    : [];
  let total = 0;
  let changed = 0;
  for (const f of files) {
    let before: MessageTree;
    try {
      before = readJsonFile(join(dir, f)) as MessageTree;
    } catch (e) {
      io.error(`uz-new-latin: ${(e as Error).message}`);
      return 2;
    }
    const after = toNewLatinMessages(before, { exceptions });
    const a = flattenMessages(before);
    const b = new Map(flattenMessages(after));
    total += a.length;
    changed += a.filter(([k, v]) => b.get(k) !== v).length;
    if (out) {
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, f), `${JSON.stringify(after, null, 2)}\n`);
    }
  }
  io.log(
    out
      ? `${changed} of ${total} strings changed; wrote ${files.length} file(s) to ${out}`
      : `${changed} of ${total} strings would change (dry run: pass --out <dir> to write copies)`,
  );
  return 0;
}
