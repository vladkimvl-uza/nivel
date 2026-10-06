// Test helpers: repository files that the tests compare the code with. Properties use fast-check (devDependency of
// @nivel/domain); the self-made seeded runner (mulberry32, forAll) was removed in WP-00, ADR-007 item 6.

/** Repository files the tests compare the code with: the owner documents and the shared money cases (read at transform time). */
const repoFiles = import.meta.glob(
  ["../../../../docs/{DECISIONS,CONCEPT,ARCHITECTURE}.md", "../../../testing/fixtures/money-cases.json"],
  { eager: true, query: "?raw", import: "default" },
);

/** Text of a repository file by its path tail, e.g. "docs/DECISIONS.md" or "fixtures/money-cases.json". */
export function repoFile(tail: string): string {
  const key = Object.keys(repoFiles).find((k) => k.endsWith(`/${tail}`));
  const text = key === undefined ? undefined : repoFiles[key];
  if (text === undefined) throw new Error(`Repository file is not available to tests: ${tail}`);
  return text;
}
