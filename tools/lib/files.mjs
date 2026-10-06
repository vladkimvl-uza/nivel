// File walking and glob matching for tools (no dependencies, works on Windows and Linux).
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  ".git",
  "coverage",
  "playwright-report",
  "test-results",
  ".data",
]);

/** Recursively lists files under `dir` as POSIX paths relative to `root`. */
export function walk(root, dir = root, { skipDirs = SKIP_DIRS } = {}) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!skipDirs.has(e.name)) out.push(...walk(root, p, { skipDirs }));
    } else if (e.isFile()) {
      out.push(toPosix(relative(root, p)));
    }
  }
  return out;
}

export function toPosix(p) {
  return p.split(sep).join("/");
}

export function isDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Expands one level of {a,b} braces (nested braces are expanded recursively). */
export function expandBraces(pattern) {
  const open = pattern.indexOf("{");
  if (open === -1) return [pattern];
  let depth = 0;
  for (let i = open; i < pattern.length; i++) {
    if (pattern[i] === "{") depth++;
    else if (pattern[i] === "}" && --depth === 0) {
      const body = pattern.slice(open + 1, i);
      const parts = [];
      let d = 0;
      let start = 0;
      for (let j = 0; j < body.length; j++) {
        if (body[j] === "{") d++;
        else if (body[j] === "}") d--;
        else if (body[j] === "," && d === 0) {
          parts.push(body.slice(start, j));
          start = j + 1;
        }
      }
      parts.push(body.slice(start));
      const head = pattern.slice(0, open);
      const tail = pattern.slice(i + 1);
      return parts.flatMap((p) => expandBraces(head + p + tail));
    }
  }
  return [pattern];
}

/**
 * Glob → RegExp. Supports **, *, ? and {a,b}; every other character is literal, so Next.js folder names
 * such as [locale] and (marketing) match as written. "dir/**" also matches "dir" itself.
 */
export function globToRegExp(glob) {
  const alternatives = expandBraces(glob).map((g) => {
    let re = "";
    for (let i = 0; i < g.length; i++) {
      const c = g[i];
      if (c === "*") {
        if (g[i + 1] === "*") {
          const atEnd = i + 2 === g.length;
          const slashBefore = i > 0 && g[i - 1] === "/";
          if (atEnd && slashBefore) {
            re = `${re.slice(0, -1)}(?:/.*)?`;
          } else if (g[i + 2] === "/") {
            re += "(?:.*/)?";
            i++;
          } else {
            re += ".*";
          }
          i++;
        } else {
          re += "[^/]*";
        }
      } else if (c === "?") {
        re += "[^/]";
      } else {
        re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      }
    }
    return re;
  });
  return new RegExp(`^(?:${alternatives.join("|")})$`);
}

export function matchesAny(path, globs) {
  return globs.some((g) => globToRegExp(g).test(path));
}
