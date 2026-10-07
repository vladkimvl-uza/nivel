import { describe, expect, it } from "vitest";
import { Throttle } from "./throttle.ts";

const SEC = 1000;
const customer = (id: number) => ({ id, group: false });
const group = { id: -1001234567890, group: true };

describe("Throttle: one message a second to a chat", () => {
  it("lets the first message through and holds the second for the rest of the second", () => {
    const t = new Throttle();
    expect(t.reserve(customer(1), 0)).toBe(0);
    expect(t.reserve(customer(1), 400)).toBe(600);
    expect(t.reserve(customer(1), 999)).toBe(1);
    expect(t.reserve(customer(1), 1000)).toBe(0);
  });

  it("does not count a refused attempt: the wait is measured from the last message that went", () => {
    const t = new Throttle();
    t.reserve(customer(1), 0);
    t.reserve(customer(1), 100);
    t.reserve(customer(1), 200);
    expect(t.reserve(customer(1), 1000)).toBe(0);
  });

  it("keeps chats apart", () => {
    const t = new Throttle();
    expect(t.reserve(customer(1), 0)).toBe(0);
    expect(t.reserve(customer(2), 0)).toBe(0);
    expect(t.reserve(customer(1), 0)).toBe(1000);
  });

  it("knows a chat by its id whether it is a number or a text", () => {
    const t = new Throttle();
    expect(t.reserve({ id: 7, group: false }, 0)).toBe(0);
    expect(t.reserve({ id: "7", group: false }, 10)).toBe(990);
  });
});

describe("Throttle: twenty messages a minute to a group", () => {
  it("lets twenty messages go in a minute, one a second, and holds the twenty-first until the first one is a minute old", () => {
    const t = new Throttle();
    for (let i = 0; i < 20; i++) expect(t.reserve(group, i * SEC)).toBe(0);
    expect(t.reserve(group, 20 * SEC)).toBe(40 * SEC);
    expect(t.reserve(group, 59 * SEC)).toBe(1 * SEC);
    expect(t.reserve(group, 60 * SEC)).toBe(0);
  });

  it("holds a message by the second as well when the minute is not full", () => {
    const t = new Throttle();
    t.reserve(group, 0);
    expect(t.reserve(group, 300)).toBe(700);
  });

  it("does not apply the minute limit of a group to a private chat", () => {
    const t = new Throttle();
    for (let i = 0; i < 20; i++) t.reserve(group, i * SEC);
    expect(t.reserve(customer(5), 20 * SEC)).toBe(0);
  });

  it("is a window that slides: after a quiet minute a group has all twenty again", () => {
    const t = new Throttle();
    for (let i = 0; i < 20; i++) t.reserve(group, i * SEC);
    const later = 5 * 60 * SEC;
    for (let i = 0; i < 20; i++) expect(t.reserve(group, later + i * SEC)).toBe(0);
  });
});

describe("Throttle: twenty-five messages a second in all", () => {
  it("holds the twenty-sixth message of a second whatever the chat", () => {
    const t = new Throttle();
    for (let i = 0; i < 25; i++) expect(t.reserve(customer(100 + i), 0)).toBe(0);
    expect(t.reserve(customer(999), 0)).toBe(1000);
    expect(t.reserve(customer(999), 1000)).toBe(0);
  });
});

describe("Throttle: waits are the longest of the limits and a refusal records nothing", () => {
  it("takes the longer of the chat and the group limit", () => {
    const t = new Throttle();
    for (let i = 0; i < 20; i++) t.reserve(group, i * SEC);
    // the chat limit says 1 s after the last one (19 s), the group says 40 s after 20 s: the longer wins
    expect(t.reserve(group, 20 * SEC)).toBe(40 * SEC);
  });

  it("forgets chats that have been quiet so the memory does not grow with every customer", () => {
    const t = new Throttle();
    for (let i = 0; i < 1000; i++) t.reserve(customer(i), i);
    expect(t.tracked()).toBeGreaterThan(0);
    t.reserve(customer(1), 10 * 60 * SEC);
    expect(t.tracked()).toBe(1);
  });

  it("refuses a time that is not a number", () => {
    const t = new Throttle();
    expect(() => t.reserve(customer(1), Number.NaN)).toThrow(RangeError);
  });
});
