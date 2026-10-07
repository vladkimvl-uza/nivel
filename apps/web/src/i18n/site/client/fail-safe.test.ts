import { describe, expect, it, vi } from "vitest";
import { FailSafe } from "./fail-safe.ts";

const make = () => new FailSafe({ fallback: "still", children: "moving" });

describe("FailSafe", () => {
  it("shows what it wraps until something fails", () => {
    expect(make().render()).toBe("moving");
  });

  it("turns into the fallback once a child failed (also a chunk that did not come)", () => {
    const box = make();
    box.state = FailSafe.getDerivedStateFromError();
    expect(box.render()).toBe("still");
  });

  it("logs the name of the error and nothing else", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("Loading chunk 413 failed: https://nivel.example/_next/x.js");
    error.name = "ChunkLoadError";
    make().componentDidCatch(error, { componentStack: "" });
    const text = JSON.stringify(log.mock.calls);
    expect(text).toContain("ChunkLoadError");
    expect(text).not.toContain("nivel.example");
    log.mockRestore();
  });
});
