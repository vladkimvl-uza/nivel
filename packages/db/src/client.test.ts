import { describe, expect, it } from "vitest";
import { createDb } from "./client.ts";

describe("createDb", () => {
  it("keeps the process alive when an idle client of the pool loses its connection", () => {
    const db = createDb("postgres://nobody@127.0.0.1:1/none");
    expect(() =>
      db.$client.emit("error", new Error("terminating connection due to administrator command")),
    ).not.toThrow();
  });

  it("hands the error of an idle client to the caller's handler", () => {
    const seen: string[] = [];
    const db = createDb("postgres://nobody@127.0.0.1:1/none", { onError: (e) => seen.push(e.message) });
    db.$client.emit("error", new Error("connection lost"));
    expect(seen).toEqual(["connection lost"]);
  });
});
