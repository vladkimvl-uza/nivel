import { describe, expect, it, vi } from "vitest";
import { fallBackToStatic } from "./fallback.ts";

function win() {
  const added: string[] = [];
  return {
    added,
    w: { document: { documentElement: { classList: { add: (n: string) => void added.push(n) } } } },
  };
}

describe("fallBackToStatic", () => {
  it("puts the page back to the static view and logs the name of the error, not its text", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { added, w } = win();
    fallBackToStatic(w, "boot", new TypeError("Failed to fetch https://secret.example/chunk.js"));
    expect(added).toEqual(["is-reduced"]);
    expect(log).toHaveBeenCalledTimes(1);
    const text = JSON.stringify(log.mock.calls);
    expect(text).toContain("TypeError");
    expect(text).not.toContain("secret.example");
    log.mockRestore();
  });

  it("copes with a thrown value that is not an error", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { added, w } = win();
    fallBackToStatic(w, "hero", "boom");
    expect(added).toEqual(["is-reduced"]);
    expect(JSON.stringify(log.mock.calls)).toContain("unknown");
    log.mockRestore();
  });
});
