// Path check of the local server of render-logo-motion.mjs, apart from it so that a test can reach it.
import { isAbsolute, join, normalize, relative } from "node:path";

/**
 * The file `requested` (a path from the URL, already decoded) inside `root`; throws when it leaves the root.
 * A plain `startsWith(root)` is not enough: a sibling folder with the same prefix (`ui` and `ui-secret`) passes it.
 * @param {string} root absolute folder
 * @param {string} requested path relative to the root
 * @returns {string} absolute path inside the root
 */
export function insideRoot(root, requested) {
  const file = normalize(join(root, requested));
  const rel = relative(root, file);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) throw new Error("outside the root");
  return file;
}
