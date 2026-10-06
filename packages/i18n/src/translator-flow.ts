// Translator flow (ARCHITECTURE 5.2, Р-25): `i18n:export` writes an XLSX with context, limits and the glossary; the translator
// edits the uz column; `i18n:import` checks every changed row and writes the message files. All checks run before any
// file is written: one error means no change at all.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type GlossaryTerm, glossaryProblems, parseGlossary } from "./glossary.ts";
import { checkIcuSyntax, placeholderSignature, placeholdersCompatible } from "./icu.ts";
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

/** Reads a JSON file; a broken file is reported with its path, not with a bare parser message. */
export function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new Error(`${path}: ${(e as Error).message}`, { cause: e });
  }
}

function readJsonOr<T>(path: string, fallback: T): T {
  return existsSync(path) ? (readJsonFile(path) as T) : fallback;
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
  return existsSync(path) ? parseGlossary(readJsonFile(path)) : null;
}

function lookup(tree: MessageTree, key: string): string | undefined {
  let node: string | MessageTree | undefined = tree;
  for (const part of key.split(".")) {
    if (node === undefined || typeof node === "string") return undefined;
    // Own properties only: a key from the file such as "constructor.name" must not walk up the prototype chain.
    node = Object.hasOwn(node, part) ? node[part] : undefined;
  }
  return typeof node === "string" ? node : undefined;
}

/** Sets a dotted key, creating objects on the way; false when a text sits where an object is needed. */
function setPath(tree: MessageTree, key: string, value: string): boolean {
  const parts = key.split(".");
  let node = tree;
  if (parts.includes("__proto__")) return false;
  for (const part of parts.slice(0, -1)) {
    const next = Object.hasOwn(node, part) ? node[part] : undefined;
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
  "3. Части в фигурных скобках — часть программы: {name}, {count, plural, one {...} other {...}}. Имена и ключевые слова внутри скобок (name, count, plural, one, other) не переводятся и не меняются; слова внутри ветвей {...} переводятся. Тип части тоже должен совпадать с русским, с одним послаблением для чисел: только если в русском тексте это число — {count, plural, ...} или {count, number}, — вместо него можно писать «{count} ta ...», {count, number} или {count, selectordinal, ...} (узбекское существительное после числа не склоняется). Обычную русскую часть без типа ({name}, {sum}) менять на число нельзя: в ней может быть имя или готовая сумма. Даты ({d, date}), время ({t, time}) и выбор ({g, select, ...}) должны совпадать строго: они требуют от программы других значений (в сообщении об ошибке тип стоит после двоеточия).",
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

/** Positions of the columns of the Translations sheet; -1 for an optional column that is not in the file. */
interface Columns {
  ns: number;
  key: number;
  ru: number;
  uz: number;
  context: number;
  maxLen: number;
  status: number;
  screenshot: number;
}

/** One data row of the sheet, resolved against the catalog. */
interface RowInfo {
  /** Row number as the translator sees it (1-based, header is row 1). */
  n: number;
  ns: string;
  key: string;
  /** "namespace:key" */
  id: string;
  ruRepo: string | undefined;
  uzRepo: string | undefined;
  meta: MetaEntry | undefined;
}

/** Finds the columns by header name; a missing required column is an error and gives null. */
function findColumns(sheet: XlsxSheet, plan: Plan): Columns | null {
  const header = (sheet.rows[0] ?? []).map((c) => (typeof c === "string" ? c.trim() : ""));
  const col = (name: string) => header.indexOf(name);
  for (const required of ["namespace", "key", "ru", "uz"]) {
    if (col(required) < 0) plan.errors.push(`${TRANSLATIONS_SHEET}: missing column "${required}"`);
  }
  if (plan.errors.length > 0) return null;
  return {
    ns: col("namespace"),
    key: col("key"),
    ru: col("ru"),
    uz: col("uz"),
    context: col("context"),
    maxLen: col("maxLen"),
    status: col("status"),
    screenshot: col("screenshot"),
  };
}

/** Number of distinct keys of the (selected) namespaces of the repository. */
function countRepoKeys(catalog: Catalog, only: ReadonlySet<string> | null): number {
  let total = 0;
  for (const [ns, data] of Object.entries(catalog)) {
    if (only && !only.has(ns)) continue;
    total += new Set([...flattenMessages(data.ru).map(([k]) => k), ...flattenMessages(data.uz).map(([k]) => k)]).size;
  }
  return total;
}

/** Read-only columns: a difference from the repository is ignored with a warning. */
function warnReadOnly(
  plan: Plan,
  row: RowInfo,
  name: string,
  column: number,
  repo: string | number | null,
  cell: XlsxCell | undefined,
): void {
  if (column < 0) return;
  const a = typeof cell === "string" ? nl(cell) : (cell ?? null);
  const b = typeof repo === "string" ? nl(repo) : repo;
  const same = a === b || ((a === null || a === "") && (b === null || b === ""));
  if (!same) {
    plan.warnings.push(
      `row ${row.n}: ${row.id} ${name} differs from the repository; the ${name} column is read-only and was ignored`,
    );
  }
}

/** The uz text as it will be checked: trimmed and, if asked, with fixed apostrophes (only for a changed cell). */
function tidyUzText(plan: Plan, row: RowInfo, text: string, options: ImportOptions): string {
  if (text === (row.uzRepo ?? "")) return text;
  let tidy = text;
  const trimmed = tidy.trim();
  if (trimmed !== tidy) {
    plan.warnings.push(`row ${row.n}: ${row.id} uz had leading or trailing spaces; trimmed`);
    tidy = trimmed;
  }
  if (options.normalize) {
    const fixed = options.normalize(tidy);
    if (fixed !== tidy) {
      plan.warnings.push(`row ${row.n}: ${row.id} uz apostrophes normalized`);
      tidy = fixed;
    }
  }
  return tidy;
}

/** The error for ICU arguments that differ from the Russian source, or null (no check when ru itself is not valid ICU). */
function placeholderError(where: string, text: string, ruRepo: string | undefined): string | null {
  if (ruRepo === undefined || checkIcuSyntax(ruRepo) !== null) return null;
  if (placeholdersCompatible(text, ruRepo)) return null;
  return `${where} placeholders differ from ru: ru {${placeholderSignature(ruRepo).join(", ")}}, uz {${placeholderSignature(text).join(", ")}}`;
}

/** All checks of a changed uz text: apostrophes, ICU, limit, dollars, glossary, Cyrillic. */
function checkUzText(plan: Plan, row: RowInfo, text: string, glossary: readonly GlossaryTerm[] | null): void {
  const where = `row ${row.n}: ${row.id}`;
  plan.errors.push(...checkUzString(where, text));
  const icu = checkIcuSyntax(text);
  if (icu) plan.errors.push(`${where} uz is not valid ICU: ${icu}`);
  else {
    const mismatch = placeholderError(where, text, row.ruRepo);
    if (mismatch) plan.errors.push(mismatch);
  }
  const maxLen = row.meta?.maxLen;
  if (typeof maxLen === "number" && text.length > maxLen)
    plan.errors.push(`${where} uz is ${text.length} > maxLen ${maxLen}`);
  if (/\$|\bUSD\b/.test(text)) plan.errors.push(`${where} uz mentions dollars; prices are in sums only`);
  if (glossary) {
    const g = glossaryProblems(row.ruRepo ?? "", text, glossary);
    plan.errors.push(...g.errors.map((e) => `${where} ${e}`));
    plan.warnings.push(...g.warnings.map((w) => `${where} ${w}`));
  }
  if (/\p{Script=Cyrillic}/u.test(text)) plan.warnings.push(`${where} uz contains Cyrillic letters`);
}

/** Checks the uz cell of a row; returns the new text, or null when the text is not changed. Errors go to the plan; the caller checks them. */
function checkUzCell(
  plan: Plan,
  row: RowInfo,
  raw: XlsxCell | undefined,
  glossary: readonly GlossaryTerm[] | null,
  options: ImportOptions,
): string | null {
  if (blank(raw)) {
    if (row.uzRepo !== undefined && row.uzRepo !== "") plan.errors.push(`row ${row.n}: ${row.id} uz is empty`);
    return null;
  }
  if (typeof raw !== "string") {
    plan.errors.push(`row ${row.n}: ${row.id} uz must be text`);
    return null;
  }
  const text = tidyUzText(plan, row, nl(raw), options);
  if (text === (row.uzRepo ?? "")) return null;
  checkUzText(plan, row, text, glossary);
  return text;
}

/** The status of a row after the import: the cell if it is valid and the key has a meta entry. */
function resolveStatus(
  plan: Plan,
  row: RowInfo,
  statusBefore: string,
  cell: XlsxCell | undefined,
  column: number,
): string {
  if (column < 0 || blank(cell)) return statusBefore;
  const s = String(cell).trim().toLowerCase();
  if (!(STATUSES as readonly string[]).includes(s)) {
    plan.errors.push(`row ${row.n}: ${row.id} status "${String(cell).trim()}" must be draft or reviewed`);
    return statusBefore;
  }
  if (!row.meta) {
    if (s !== statusBefore) plan.warnings.push(`row ${row.n}: ${row.id} has no meta entry; status ignored`);
    return statusBefore;
  }
  return s;
}

/** Writes a checked change of one row into the next catalog and the change list. */
function applyRowChange(
  plan: Plan,
  row: RowInfo,
  uzAfter: string | null,
  statusBefore: string,
  statusAfter: string,
): void {
  const uzChanged = uzAfter !== null;
  const statusChanged = statusAfter !== statusBefore;
  if (!uzChanged && !statusChanged) {
    plan.unchanged++;
    return;
  }
  const nextData = plan.next[row.ns] as NamespaceData;
  if (uzChanged && !setPath(nextData.uz, row.key, uzAfter)) {
    plan.errors.push(`row ${row.n}: ${row.id} cannot be placed: a text already sits on its path in uz`);
    return;
  }
  if (uzChanged) plan.touchedUz.add(row.ns);
  if (statusChanged) {
    (nextData.meta[row.key] as MetaEntry).status = statusAfter as MetaEntry["status"];
    plan.touchedMeta.add(row.ns);
  }
  plan.changes.push({
    namespace: row.ns,
    key: row.key,
    uzChanged,
    statusChanged,
    uzBefore: row.uzRepo ?? null,
    uzAfter: uzAfter ?? row.uzRepo ?? "",
    statusBefore,
    statusAfter,
  });
}

/** Rows seen so far: duplicates are an error, valid ones are not "missing". */
interface RowLedger {
  seen: Map<string, number>;
  valid: Set<string>;
}

/** What every row of one import is read against. */
interface RowScope {
  catalog: Catalog;
  columns: Columns;
  only: ReadonlySet<string> | null;
  ledger: RowLedger;
  glossary: readonly GlossaryTerm[] | null;
  options: ImportOptions;
}

/** Resolves namespace and key of a row against the catalog; null (with an error) when the row cannot be imported. */
function resolveRow(plan: Plan, scope: RowScope, cells: readonly XlsxCell[], n: number): RowInfo | null {
  const { catalog, columns: C, only, ledger } = scope;
  const ns = String(cells[C.ns] ?? "").trim();
  const key = String(cells[C.key] ?? "").trim();
  if (ns === "" || key === "") {
    plan.errors.push(`row ${n}: namespace and key are required`);
    return null;
  }
  if (only && !only.has(ns)) return null;
  const data = Object.hasOwn(catalog, ns) ? catalog[ns] : undefined;
  if (!data) {
    plan.errors.push(`row ${n}: unknown namespace "${ns}"`);
    return null;
  }
  const id = `${ns}:${key}`;
  const first = ledger.seen.get(id);
  if (first !== undefined) {
    plan.errors.push(`row ${n}: duplicate row for ${id} (first seen in row ${first})`);
    return null;
  }
  ledger.seen.set(id, n);
  const ruRepo = lookup(data.ru, key);
  const uzRepo = lookup(data.uz, key);
  if (ruRepo === undefined && uzRepo === undefined) {
    plan.errors.push(
      `row ${n}: key "${key}" does not exist in namespace "${ns}" (new keys are added in code, not in the file)`,
    );
    return null;
  }
  ledger.valid.add(id);
  return { n, ns, key, id, ruRepo, uzRepo, meta: data.meta[key] };
}

/** Checks one data row and, when it is clean and changed, records the change. */
function planRow(plan: Plan, scope: RowScope, row: RowInfo, cells: readonly XlsxCell[]): void {
  const { columns: C, glossary, options } = scope;
  const errorsBefore = plan.errors.length;
  const { meta } = row;
  warnReadOnly(plan, row, "ru", C.ru, row.ruRepo ?? "", cells[C.ru]);
  warnReadOnly(plan, row, "context", C.context, meta?.context ?? "", cells[C.context]);
  warnReadOnly(plan, row, "maxLen", C.maxLen, meta?.maxLen ?? null, cells[C.maxLen]);
  warnReadOnly(plan, row, "screenshot", C.screenshot, meta?.screenshot ?? null, cells[C.screenshot]);

  const uzAfter = checkUzCell(plan, row, cells[C.uz], glossary, options);
  const statusBefore = meta?.status ?? "draft";
  const statusAfter = resolveStatus(plan, row, statusBefore, cells[C.status], C.status);
  if (plan.errors.length > errorsBefore) return;
  applyRowChange(plan, row, uzAfter, statusBefore, statusAfter);
}

/** Checks the rows of the Translations sheet against the catalog and prepares the new catalog. Writes nothing. */
function planImportRaw(
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
  const columns = findColumns(sheet, plan);
  if (!columns) return plan;

  const only = options.namespaces ? new Set(options.namespaces) : null;
  const scope: RowScope = { catalog, columns, only, ledger: { seen: new Map(), valid: new Set() }, glossary, options };
  for (let i = 1; i < sheet.rows.length; i++) {
    const cells = sheet.rows[i] as XlsxCell[];
    if (cells.every(blank)) continue;
    const row = resolveRow(plan, scope, cells, i + 1);
    if (row) planRow(plan, scope, row, cells);
  }
  plan.missing = countRepoKeys(catalog, only) - scope.ledger.valid.size;
  return plan;
}

const MAX_MESSAGE_CHARS = 400;

/**
 * A message that quotes a cell of the file goes to a terminal. Control characters (escape sequences that redraw the screen
 * or set the window title) are replaced and very long values are cut.
 */
function printable(line: string): string {
  const clean = line.replace(/\p{Cc}/gu, "�");
  return clean.length > MAX_MESSAGE_CHARS ? `${clean.slice(0, MAX_MESSAGE_CHARS)}…` : clean;
}

/** Checks a workbook against the catalog and plans the changes; nothing is written here. */
export function planImport(
  catalog: Catalog,
  sheets: readonly XlsxSheet[],
  glossary: readonly GlossaryTerm[] | null,
  options: ImportOptions = {},
): Plan {
  const plan = planImportRaw(catalog, sheets, glossary, options);
  plan.errors = plan.errors.map(printable);
  plan.warnings = plan.warnings.map(printable);
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
