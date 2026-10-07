import { describe, expect, it } from "vitest";
import { objectionOf } from "./read-orders.ts";

const at = (seq: number, type: string, text?: string) => ({
  seq,
  event: { type, ...(text === undefined ? {} : { text }) },
});

describe("the objection of the customer to the report", () => {
  it("is null when the customer did not object", () => {
    expect(objectionOf([at(1, "SEND_REPORT")], null)).toBeNull();
  });

  it("is open with the last words while no answer of the owner is newer", () => {
    const events = [at(1, "SEND_REPORT"), at(2, "OBJECTION", "Первое"), at(3, "OBJECTION", "Второе")];
    expect(objectionOf(events, null)).toEqual({ text: "Второе", resolved: false });
    expect(objectionOf(events, { resolvedAfterSeq: 2, note: "Ответ" })).toEqual({ text: "Второе", resolved: false });
  });

  it("is answered when the answer of the owner is newer than the last objection", () => {
    const events = [at(1, "OBJECTION", "Вопрос")];
    expect(objectionOf(events, { resolvedAfterSeq: 1, note: "Чек приложен" })).toEqual({
      note: "Чек приложен",
      resolved: true,
    });
  });

  it("does not break on an event without text or on a stored value of a strange shape", () => {
    expect(objectionOf([at(1, "OBJECTION")], { resolvedAfterSeq: "x" })).toEqual({ text: "", resolved: false });
    expect(objectionOf([], {})).toBeNull();
  });
});
