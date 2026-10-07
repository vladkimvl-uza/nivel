import { describe, expect, it } from "vitest";
import { actionTitle, changedPaths, parseJournalQuery, redact } from "./journal.ts";

describe("parseJournalQuery", () => {
  it("takes known filters, trims them, and turns dates of Tashkent into UTC bounds", () => {
    const q = parseJournalQuery({
      entity: " ops.settings ",
      actor: "admin:1",
      action: "setting",
      from: "2026-10-06",
      to: "2026-10-07",
      page: "3",
    });
    expect(q).toEqual({
      entity: "ops.settings",
      actor: "admin:1",
      action: "setting",
      from: new Date("2026-10-05T19:00:00.000Z"),
      to: new Date("2026-10-07T19:00:00.000Z"),
      page: 3,
      pageSize: 50,
    });
  });

  it("drops what is not a filter, bad dates and nonsense pages", () => {
    const q = parseJournalQuery({ entity: "", from: "yesterday", to: "2026-02-30", page: "-1", surprise: "x" });
    expect(q).toEqual({ page: 1, pageSize: 50 });
  });

  it("cuts a very long text, and ignores an array of values", () => {
    const q = parseJournalQuery({ actor: "x".repeat(500), action: ["a", "b"] as never });
    expect(q.actor).toHaveLength(120);
    expect(q.action).toBeUndefined();
  });
});

describe("changedPaths", () => {
  it("lists the fields that differ, as dotted paths", () => {
    expect(changedPaths({ a: 1, b: { c: 2, d: 3 }, e: [1, 2] }, { a: 1, b: { c: 5, d: 3 }, e: [1, 3] })).toEqual([
      "b.c",
      "e",
    ]);
  });

  it("shows added and removed fields, and the whole value when one side is empty", () => {
    expect(changedPaths({ a: 1 }, { a: 1, b: 2 })).toEqual(["b"]);
    expect(changedPaths({ a: 1, b: 2 }, { a: 1 })).toEqual(["b"]);
    expect(changedPaths(null, { a: 1, b: { c: 2 } })).toEqual(["a", "b.c"]);
    expect(changedPaths({ a: 1 }, null)).toEqual(["a"]);
    expect(changedPaths(null, null)).toEqual([]);
    expect(changedPaths(5, 6)).toEqual(["(значение)"]);
  });

  it("is short: no more than 12 paths", () => {
    const after = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]));
    expect(changedPaths({}, after)).toHaveLength(12);
  });
});

describe("redact", () => {
  it("hides anything that looks like a secret, at any depth", () => {
    expect(
      redact({
        email: "a@b.c",
        password: "x",
        passwordHash: "y",
        nested: { totp_secret_enc: "z", token: "t", ok: 1 },
        list: [{ apiKey: "k" }],
      }),
    ).toEqual({
      email: "a@b.c",
      password: "***",
      passwordHash: "***",
      nested: { totp_secret_enc: "***", token: "***", ok: 1 },
      list: [{ apiKey: "***" }],
    });
  });

  it("leaves plain values alone", () => {
    expect(redact(5)).toBe(5);
    expect(redact(null)).toBeNull();
    expect(redact("text")).toBe("text");
  });
});

describe("actionTitle", () => {
  it("gives a Russian name to the actions of this package and keeps the unknown ones as they are", () => {
    expect(actionTitle("auth.login")).toBe("Вход");
    expect(actionTitle("auth.login_failed")).toBe("Неудачный вход");
    expect(actionTitle("auth.locked")).toBe("Блокировка входа");
    expect(actionTitle("setting.set")).toBe("Изменение настройки");
    expect(actionTitle("catalog.import")).toBe("Импорт каталога");
    expect(actionTitle("files.upload")).toBe("Загрузка файла");
    expect(actionTitle("orders.dispatch")).toBe("orders.dispatch");
    expect(actionTitle("catalog.update")).toBe("Изменение позиции");
  });
});
