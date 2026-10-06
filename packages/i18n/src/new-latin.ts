// Preparation for the new Uzbek Latin alphabet (ARCHITECTURE 5.2, block 26 section 7.3): oʻ→ö, gʻ→ğ, sh→ş, ch→ç.
// The law is not in force yet; nothing calls this at runtime. The script tools/uz-new-latin.mjs writes converted copies
// for the native editor to review. The letter set of the final law is not confirmed, so the mapping stays in one table.

/** Brands and names that keep their spelling. Extended per run with --exceptions (a JSON array of words). */
export const DEFAULT_NEW_LATIN_EXCEPTIONS: readonly string[] = [
  "Logitech",
  "Toshiba",
  "Cherry",
  "Chieftec",
  "Chrome",
  "Chromebook",
  "Schneider",
  "Sharkoon",
  "Shure",
  "Shuttle",
];

export interface NewLatinOptions {
  /** Whole words (any case) that must stay as they are, added to the default list: s+h at a morpheme joint, names, brands. */
  exceptions?: readonly string[];
}

// Never converted: URLs, e-mail addresses, @handles, markup tags.
const LITERAL = /https?:\/\/[^\s<>"{}]+|www\.[^\s<>"{}]+|[\w.+-]+@[\w-]+(?:\.[\w-]+)+|@\w+|<\/?[A-Za-z][^<>]*>/gu;
const WORD = /[\p{L}ʻʼ]+/gu;

const LETTERS: Record<string, string> = { o: "ö", O: "Ö", g: "ğ", G: "Ğ" };

function convertWord(word: string): string {
  return word
    .replace(/([oOgG])ʻ/g, (_m, c: string) => LETTERS[c] as string)
    .replace(/([sS])[hH]/g, (_m, c: string) => (c === "s" ? "ş" : "Ş"))
    .replace(/([cC])[hH]/g, (_m, c: string) => (c === "c" ? "ç" : "Ç"));
}

function convertPlain(text: string, exceptions: ReadonlySet<string>): string {
  let out = "";
  let last = 0;
  for (const lit of text.matchAll(LITERAL)) {
    out += convertWords(text.slice(last, lit.index), exceptions) + lit[0];
    last = lit.index + lit[0].length;
  }
  return out + convertWords(text.slice(last), exceptions);
}

function convertWords(text: string, exceptions: ReadonlySet<string>): string {
  return text.replace(WORD, (w) => (exceptions.has(w.toLowerCase()) ? w : convertWord(w)));
}

/** Converts one string. ICU syntax (argument names, types, selectors) is left alone, the text inside branches is converted. */
export function toNewLatin(text: string, options: NewLatinOptions = {}): string {
  const exceptions = new Set(
    [...DEFAULT_NEW_LATIN_EXCEPTIONS, ...(options.exceptions ?? [])].map((w) => w.toLowerCase()),
  );
  // ICU modes: "text" (root and inside a branch) is converted; "header" ({name, type, selector) is not.
  const stack: ("text" | "header")[] = ["text"];
  let out = "";
  let buffer = "";
  const flush = () => {
    out += convertPlain(buffer, exceptions);
    buffer = "";
  };
  for (const ch of text) {
    const mode = stack[stack.length - 1];
    if (mode === "text") {
      if (ch === "{") {
        flush();
        out += ch;
        stack.push("header");
      } else if (ch === "}" && stack.length > 1) {
        flush();
        out += ch;
        stack.pop();
      } else {
        buffer += ch;
      }
    } else {
      out += ch;
      if (ch === "{") stack.push("text");
      else if (ch === "}") stack.pop();
    }
  }
  flush();
  return out;
}

/** Converts every string of a nested message catalog; other values are returned as they are. The input is not changed. */
export function toNewLatinMessages<T>(tree: T, options: NewLatinOptions = {}): T {
  if (typeof tree === "string") return toNewLatin(tree, options) as T;
  if (Array.isArray(tree)) return tree.map((v) => toNewLatinMessages(v, options)) as T;
  if (tree && typeof tree === "object") {
    return Object.fromEntries(Object.entries(tree).map(([k, v]) => [k, toNewLatinMessages(v, options)])) as T;
  }
  return tree;
}
