// What the page does when one of its scripts fails (a chunk that did not come, a layout that does not match): it goes back to the
// static view, `is-reduced`, which every rule of the motion respects, so nothing stays hidden while it waits for a script. This
// file is small on purpose: the page loads it with the first load, and the chunk that failed may be the one with the rest.

/** The part of the window the fallback touches. */
export interface FallbackWin {
  document: { documentElement: { classList: { add(name: string): void } } };
}

/** Only the name of the error is logged: its text may carry addresses. */
export function fallBackToStatic(win: FallbackWin, what: string, error: unknown): void {
  win.document.documentElement.classList.add("is-reduced");
  console.error("site: a script of the page failed, the page stays static", {
    what,
    error: error instanceof Error ? error.name : "unknown",
  });
}
