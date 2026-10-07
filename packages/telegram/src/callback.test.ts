import { describe, expect, it } from "vitest";
import {
  actCallback,
  CALLBACK_DATA_MAX_BYTES,
  decodeCallback,
  encodeCallback,
  hexToUuid,
  orderCallback,
  uuidToHex,
} from "./callback.ts";

describe("encodeCallback / decodeCallback", () => {
  it("writes the architecture example o:NV-2026-0001:ack", () => {
    expect(encodeCallback("o", ["NV-2026-0001", "ack"])).toBe("o:NV-2026-0001:ack");
  });

  it("round-trips scope and arguments", () => {
    const data = encodeCallback("sel", ["task", "gaming"]);
    expect(decodeCallback(data)).toEqual({ scope: "sel", args: ["task", "gaming"] });
  });

  it("accepts a scope without arguments", () => {
    expect(decodeCallback(encodeCallback("cn", []))).toEqual({ scope: "cn", args: [] });
  });

  it("keeps the limit of Telegram: 64 bytes", () => {
    expect(CALLBACK_DATA_MAX_BYTES).toBe(64);
    const fits = encodeCallback("o", ["x".repeat(30), "y".repeat(29), "z"]);
    expect(Buffer.byteLength(fits, "utf8")).toBe(64);
    expect(() => encodeCallback("o", ["x".repeat(30), "y".repeat(30), "z"])).toThrow(/64/);
  });

  it("refuses parts outside the Latin identifier alphabet (the data must stay ASCII)", () => {
    for (const bad of ["Ўзбек", "a b", "a:b", "x/y", "", "ä", "💥"]) {
      expect(() => encodeCallback("o", [bad])).toThrow(/callback/i);
    }
    expect(() => encodeCallback("", ["a"])).toThrow(/callback/i);
    expect(() => encodeCallback("O.K", [])).not.toThrow();
  });

  it("decodes only what it could have written", () => {
    for (const junk of ["", ":", "o:", "o::a", "o:a b", "a".repeat(65), "o:Ўзбек", "o:NV-1:ack:", "\n"]) {
      expect(decodeCallback(junk)).toBeNull();
    }
    expect(decodeCallback(undefined)).toBeNull();
    expect(decodeCallback(42 as never)).toBeNull();
  });
});

describe("typed builders", () => {
  it("order buttons carry the number, the action and an optional argument", () => {
    expect(orderCallback("NV-2026-0001", "acc")).toBe("o:NV-2026-0001:acc");
    expect(orderCallback("NV-2026-0001", "ev", "START_PURCHASE")).toBe("o:NV-2026-0001:ev:START_PURCHASE");
    expect(
      Buffer.byteLength(orderCallback("NV-2026-123456", "ev", "REPORT_DEEMED_ACCEPTED"), "utf8"),
    ).toBeLessThanOrEqual(64);
  });

  it("the act button carries the id of the act as 32 hex digits", () => {
    const id = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
    expect(uuidToHex(id)).toBe("0190a1b2c3d47e5f8a9b0c1d2e3f4a5b");
    expect(hexToUuid("0190a1b2c3d47e5f8a9b0c1d2e3f4a5b")).toBe(id);
    expect(actCallback(id)).toBe("a:0190a1b2c3d47e5f8a9b0c1d2e3f4a5b:sg");
    expect(Buffer.byteLength(actCallback(id), "utf8")).toBeLessThanOrEqual(64);
  });

  it("refuses an id that is not a uuid", () => {
    expect(() => uuidToHex("not-a-uuid")).toThrow(/uuid/i);
    expect(hexToUuid("zz")).toBeNull();
    expect(hexToUuid("0190a1b2c3d47e5f8a9b0c1d2e3f4a5")).toBeNull();
  });
});
