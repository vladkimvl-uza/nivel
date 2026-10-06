// Translator flow (ARCHITECTURE 5.2, Р-25): `i18n:export` writes an XLSX with context, limits and the glossary; the translator
// edits the uz column; `i18n:import` checks every changed row and writes the message files. All checks run before any
// file is written: one error means no change at all.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type GlossaryTerm, glossaryProblems, parseGlossary } from "./glossary.ts";
import { checkIcuSyntax, placeholderSignature, placeholders } from "./icu.ts";
import { flattenMessages, type MessageTree, type MetaEntry } from "./messages-check.ts";
import { checkUzString } from "./uz-apostrophes.ts";
import { readXlsx, type SheetData, writeXlsx, type XlsxCell, type XlsxSheet } from "./xlsx.ts";

export const TRANSLATIONS_SHEET = "Translations";
export const GUIDE_SHEET = "Памятка";
export const GLOSSARY_SHEET = "Glossary";
export const TRANSLATION_COLUMNS = [
  "namespace",
  "key",
  "context",
  "maxLen",
  "ru",
  "uz",
  "status",
  "screenshot",
] as const;

export interface NamespaceData {
  uz: MessageTree;
  ru: MessageTree;
  meta: Record<string, MetaEntry>;
}
export type Catalog = Record<string, NamespaceData>;

const STATUSES = ["draft", "reviewed"] as const;

const messagesDir = (root: string) => join(root, "packages", "i18n", "messages");
const messagePath = (root: string, kind: "uz" | "ru" | "meta", ns: string) =>
  join(messagesDir(root), kind, `${ns}.json`);
const glossaryPath = (root: string) => join(root, "packages", "db", "seed", "glossary", "glossary.json");
const relPath = (kind: "uz" | "ru" | "meta", ns: string) => `packages/i18n/messages/${kind}/${ns}.json`;

function readJsonOr<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback;
}

/** Reads message files; `only` limits (and validates) the namespaces. */
export function readCatalog(root: string, only?: readonly string[]): Catalog {
  const found = new Set<string>();
  for (const kind of ["uz", "ru", "meta"] as const) {
    const dir = join(messagesDir(root), kind);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) if (f.endsWith(".json")) found.add(f.replace(/\.json$/, ""));
  }
  for (const ns of only ?? []) if (!found.has(ns)) throw new Error(`Unknown namespace "${ns}"`);
  const names = [...(only ?? found)].sort();
  return Object.fromEntries(
    names.map((ns) => [
      ns,
      {
        uz: readJsonOr<MessageTree>(messagePath(root, "uz", ns), {}),
        ru: readJsonOr<MessageTree>(messagePath(root, "ru", ns), {}),
        meta: readJsonOr<Record<string, MetaEntry>>(messagePath(root, "meta", ns), {}),
      },
    ]),
  );
}

/** The glossary seed of the repository, or null when the file is not there. */
export function readGlossary(root: string): GlossaryTerm[] | null {
  const path = glossaryPath(root);
  return existsSync(path) ? parseGlossary(JSON.parse(readFileSync(path, "utf8"))) : null;
}

function lookup(tree: MessageTree, key: string): string | undefined {
  let node: string | MessageTree | undefined = tree;
  for (const part of key.split(".")) {
    if (node === undefined || typeof node === "string") return undefined;
    node = node[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** Sets a dotted key, creating objects on the way; false when a text sits where an object is needed. */
function setPath(tree: MessageTree, key: string, value: string): boolean {
  const parts = key.split(".");
  let node = tree;
  for (const part of parts.slice(0, -1)) {
    const next = node[part];
    if (next === undefined) node = node[part] = {};
    else if (typeof next === "string") return false;
    else node = next;
  }
  node[parts[parts.length - 1] as string] = value;
  return true;
}

// ---- export -------------------------------------------------------------------------------------------------------

const GUIDE_LINES = [
  "Памятка переводчику",
  "",
  "1. Править нужно только колонку uz (перевод) и, когда текст проверен носителем, колонку status. Остальные колонки справочные: правки в них при импорте игнорируются.",
  "2. Колонка ru — исходный русский текст, колонка context — где и как показывается текст, колонка maxLen — предельная длина в знаках. Длиннее нельзя: импорт откажет.",
  "3. Части в фигурных скобках — часть программы: {name}, {count, plural, one {...} other {...}}. Имена и ключевые слова внутри скобок (name, count, plural, one, other) не переводятся и не меняются; слова внутри ветвей {...} переводятся.",
  "4. Знаки узбекского: oʻ и gʻ пишутся со знаком ʻ (U+02BB); тутук и прочие апострофы между буквами — ʼ (U+02BC). Обычный апостроф ' (U+0027) и ’ (U+2019) внутри слов импорт не примет.",
  "5. Цены только в сумах: «12 500 000 soʻm». Знак доллара и USD недопустимы.",
  "6. Термины — по листу Glossary; обращение к клиенту — Siz. Варианты вне глоссария (например, «tezkor xotira» вместо «operativ xotira») импорт отклонит.",
  "7. Перенос строки внутри ячейки — Alt+Enter. Лишние пробелы в начале и в конце импорт уберёт.",
  "8. Новые ключи в файл не добавляются, колонки namespace и key не меняются. Строки, которые вы не трогали, остаются как были; строки можно удалять, если вы переводите часть файла.",
  "9. status: draft — черновик; reviewed — проверено носителем. Узбекский текст со статусом draft ещё должен проверить второй носитель.",
];

/** Sheets of the translator workbook. */
export function buildExportSheets(catalog: Catalog, glossary: readonly GlossaryTerm[] | null): SheetData[] {
  const rows: XlsxCell[][] = [[...TRANSLATION_COLUMNS]];
  for (const ns of Object.keys(catalog).sort()) {
    const data = catalog[ns] as NamespaceData;
    const ru = new Map(flattenMessages(data.ru));
    const uz = new Map(flattenMessages(data.uz));
    for (const key of new Set([...ru.keys(), ...uz.keys()])) {
      const meta = data.meta[key];
      rows.push([
        ns,
        key,
        meta?.context ?? "",
        meta?.maxLen ?? null,
        ru.get(key) ?? "",
        uz.get(key) ?? "",
        meta?.status ?? "draft",
        meta?.screenshot ?? null,
      ]);
    }
  }
  const sheets: SheetData[] = [
    {
      name: TRANSLATIONS_SHEET,
      rows,
      columnWidths: [12, 28, 36, 9, 52, 52, 10, 26],
      freezeHeader: true,
      editableColumns: [TRANSLATION_COLUMNS.indexOf("uz"), TRANSLATION_COLUMNS.indexOf("status")],
    },
    { name: GUIDE_SHEET, rows: GUIDE_LINES.map((line) => [line]), columnWidths: [140] },
  ];
  if (glossary) {
    sheets.push({
      name: GLOSSARY_SHEET,
      rows: [["no", "ru", "uz", "note"], ...glossary.map((t): XlsxCell[] => [t.no, t.termRu, t.termUz, t.note])],
      columnWidths: [6, 38, 38, 60],
      freezeHeader: true,
    });
  }
  return sheets;
}

export function exportTranslations(root: string, options: { namespaces?: readonly string[] } = {}): Buffer {
  return writeXlsx(buildExportSheets(readCatalog(root, options.namespaces), readGlossary(root)));
}

// ---- import -------------------------------------------------------------------------------------------------------

export interface ImportOptions {
  /** Check everything, write nothing. */
  dryRun?: boolean;
  /** Fixes apostrophes of changed Uzbek texts before the checks (normalizeUz of packages/domain). */
  normalize?: (uz: string) => string;
  /** Import only these namespaces; rows of the others are skipped. */
  namespaces?: readonly string[];
}

export interface ImportChange {
  namespace: string;
  key: string;
  uzChanged: boolean;
  statusChanged: boolean;
  uzBefore: string | null;
  uzAfter: string;
  statusBefore: string;
  statusAfter: string;
}

export interface ImportReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  changes: ImportChange[];
  /** Rows without any change. */
  unchanged: number;
  /** Keys of the repository that are not in the file (a partial file is allowed). */
  missing: number;
  /** Files written, relative to the repository root. */
  written: string[];
}

interface Plan extends Omit<ImportReport, "ok" | "written"> {
  next: Catalog;
  touchedUz: Set<string>;
  touchedMeta: Set<string>;
}

const nl = (s: string) => s.replace(/\r\n?/g, "\n");
const blank = (c: XlsxCell | undefined) => c === null || c === undefined || (typeof c === "string" && c.trim() === "");

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Checks the rows of the Translations sheet against the catalog and prepares the new catalog. Writes nothing. */
export function planImport(
  catalog: Catalog,
  sheets: readonly XlsxSheet[],
  glossary: readonly GlossaryTerm[] | null,
  options: ImportOptions = {},
): Plan {
  const plan: Plan = {
    errors: [],
    warnings: [],
    changes: [],
    unchanged: 0,
    missing: 0,
    next: clone(catalog),
    touchedUz: new Set(),
    touchedMeta: new Set(),
  };
  const sheet = sheets.find((s) => s.name === TRANSLATIONS_SHEET);
  if (!sheet) {
    plan.errors.push(`sheet "${TRANSLATIONS_SHEET}" not found`);
    return plan;
  }
  const header = (sheet.rows[0] ?? []).map((c) => (typeof c === "string" ? c.trim() : ""));
  const col = (name: string) => header.indexOf(name);
  for (const required of ["namespace", "key", "ru", "uz"]) {
    if (col(required) < 0) plan.errors.push(`${TRANSLATIONS_SHEET}: missing column "${required}"`);
  }
  if (plan.errors.length > 0) return plan;
  const C = {
    ns: col("namespace"),
    key: col("key"),
    ru: col("ru"),
    uz: col("uz"),
    context: col("context"),
    maxLen: col("maxLen"),
    status: col("status"),
    screenshot: col("screenshot"),
  };

  const only = options.namespaces ? new Set(options.namespaces) : null;
  const seen = new Map<string, number>();
  const valid = new Set<string>();
  let total = 0;
  for (const [ns, data] of Object.entries(catalog)) {
    if (only && !only.has(ns)) continue;
    total += new Set([...flattenMessages(data.ru).map(([k]) => k), ...flattenMessages(data.uz).map(([k]) => k)]).size;
  }

  for (let i = 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i] as XlsxCell[];
    if (row.every(blank)) continue;
    const n = i + 1;
    const ns = String(row[C.ns] ?? "").trim();
    const key = String(row[C.key] ?? "").trim();
    if (ns === "" || key === "") {
      plan.errors.push(`row ${n}: namespace and key are required`);
      continue;
    }
    if (only && !only.has(ns)) continue;
    const data = catalog[ns];
    if (!data) {
      plan.errors.push(`row ${n}: unknown namespace "${ns}"`);
      continue;
    }
    const id = `${ns}:${key}`;
    const first = seen.get(id);
    if (first !== undefined) {
      plan.errors.push(`row ${n}: duplicate row for ${id} (first seen in row ${first})`);
      continue;
    }
    seen.set(id, n);
    const ruRepo = lookup(data.ru, key);
    const uzRepo = lookup(data.uz, key);
    if (ruRepo === undefined && uzRepo === undefined) {
      plan.errors.push(
        `row ${n}: key "${key}" does not exist in namespace "${ns}" (new keys are added in code, not in the file)`,
      );
      continue;
    }
    valid.add(id);
    const meta = data.meta[key];
    const errorsBefore = plan.errors.length;

    // Read-only columns: differences are ignored with a warning.
    const readOnly = (name: string, column: number, repo: string | number | null, cell: XlsxCell | undefined) => {
      if (column < 0) return;
      const a = typeof cell === "string" ? nl(cell) : (cell ?? null);
      const b = typeof repo === "string" ? nl(repo) : repo;
      const same = a === b || ((a === null || a === "") && (b === null || b === ""));
      if (!same)
        plan.warnings.push(
          `row ${n}: ${id} ${name} differs from the repository; the ${name} column is read-only and was ignored`,
        );
    };
    readOnly("ru", C.ru, ruRepo ?? "", row[C.ru]);
    readOnly("context", C.context, meta?.context ?? "", row[C.context]);
    readOnly("maxLen", C.maxLen, meta?.maxLen ?? null, row[C.maxLen]);
    readOnly("screenshot", C.screenshot, meta?.screenshot ?? null, row[C.screenshot]);

    // Uzbek text.
    let uzAfter: string | null = null;
    const raw = row[C.uz];
    if (blank(raw)) {
      if (uzRepo !== undefined && uzRepo !== "") plan.errors.push(`row ${n}: ${id} uz is empty`);
    } else if (typeof raw !== "string") {
      plan.errors.push(`row ${n}: ${id} uz must be text`);
    } else {
      let text = nl(raw);
      if (text !== (uzRepo ?? "")) {
        const trimmed = text.trim();
        if (trimmed !== text) {
          plan.warnings.push(`row ${n}: ${id} uz had leading or trailing spaces; trimmed`);
          text = trimmed;
        }
        if (options.normalize) {
          const fixed = options.normalize(text);
          if (fixed !== text) {
            plan.warnings.push(`row ${n}: ${id} uz apostrophes normalized`);
            text = fixed;
          }
        }
      }
      if (text !== (uzRepo ?? "")) {
        const where = `row ${n}: ${id}`;
        plan.errors.push(...checkUzString(where, text));
        const icu = checkIcuSyntax(text);
        if (icu) plan.errors.push(`${where} uz is not valid ICU: ${icu}`);
        else if (ruRepo !== undefined && checkIcuSyntax(ruRepo) === null) {
          if (placeholderSignature(text).join() !== placeholderSignature(ruRepo).join()) {
            plan.errors.push(
              `${where} placeholders differ from ru: ru {${placeholders(ruRepo)}}, uz {${placeholders(text)}}`,
            );
          }
        }
        if (typeof meta?.maxLen === "number" && text.length > meta.maxLen) {
          plan.errors.push(`${where} uz is ${text.length} > maxLen ${meta.maxLen}`);
        }
        if (/\$|\bUSD\b/.test(text)) plan.errors.push(`${where} uz mentions dollars; prices are in sums only`);
        if (glossary) {
          const g = glossaryProblems(ruRepo ?? "", text, glossary);
          plan.errors.push(...g.errors.map((e) => `${where} ${e}`));
          plan.warnings.push(...g.warnings.map((w) => `${where} ${w}`));
        }
        if (/\p{Script=Cyrillic}/u.test(text)) plan.warnings.push(`${where} uz contains Cyrillic letters`);
        uzAfter = text;
      }
    }

    // Status.
    const statusBefore = meta?.status ?? "draft";
    let statusAfter: string = statusBefore;
    if (C.status >= 0 && !blank(row[C.status])) {
      const s = String(row[C.status]).trim().toLowerCase();
      if (!(STATUSES as readonly string[]).includes(s))
        plan.errors.push(`row ${n}: ${id} status "${String(row[C.status]).trim()}" must be draft or reviewed`);
      else if (!meta) {
        if (s !== statusBefore) plan.warnings.push(`row ${n}: ${id} has no meta entry; status ignored`);
      } else statusAfter = s;
    }

    const uzChanged = uzAfter !== null;
    const statusChanged = statusAfter !== statusBefore;
    if (plan.errors.length > errorsBefore) continue;
    if (!uzChanged && !statusChanged) {
      plan.unchanged++;
      continue;
    }
    const nextData = plan.next[ns] as NamespaceData;
    if (uzChanged && !setPath(nextData.uz, key, uzAfter as string)) {
      plan.errors.push(`row ${n}: ${id} cannot be placed: a text already sits on its path in uz`);
      continue;
    }
    if (uzChanged) plan.touchedUz.add(ns);
    if (statusChanged) {
      (nextData.meta[key] as MetaEntry).status = statusAfter as MetaEntry["status"];
      plan.touchedMeta.add(ns);
    }
    plan.changes.push({
      namespace: ns,
      key,
      uzChanged,
      statusChanged,
      uzBefore: uzRepo ?? null,
      uzAfter: uzAfter ?? uzRepo ?? "",
      statusBefore,
      statusAfter,
    });
  }
  plan.missing = total - valid.size;
  return plan;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** Imports a translator workbook into the message files of `root`. Nothing is written if any row has an error. */
export function importTranslations(root: string, xlsx: Buffer, options: ImportOptions = {}): ImportReport {
  let sheets: XlsxSheet[];
  try {
    sheets = readXlsx(xlsx);
  } catch (e) {
    return {
      ok: false,
      errors: [(e as Error).message],
      warnings: [],
      changes: [],
      unchanged: 0,
      missing: 0,
      written: [],
    };
  }
  const plan = planImport(readCatalog(root, options.namespaces), sheets, readGlossary(root), options);
  const written: string[] = [];
  if (plan.errors.length === 0 && !options.dryRun) {
    for (const ns of [...plan.touchedUz].sort()) {
      writeJson(messagePath(root, "uz", ns), (plan.next[ns] as NamespaceData).uz);
      written.push(relPath("uz", ns));
    }
    for (const ns of [...plan.touchedMeta].sort()) {
      writeJson(messagePath(root, "meta", ns), (plan.next[ns] as NamespaceData).meta);
      written.push(relPath("meta", ns));
    }
  }
  return {
    ok: plan.errors.length === 0,
    errors: plan.errors,
    warnings: plan.warnings,
    changes: plan.changes,
    unchanged: plan.unchanged,
    missing: plan.missing,
    written,
  };
}
