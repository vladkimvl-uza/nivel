import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "./errors.ts";
import { takeNumber } from "./numbers.ts";
import { createWorld, type World } from "./test-support/world.ts";

let w: World;
beforeAll(async () => {
  w = await createWorld();
});
afterAll(async () => {
  await w.close();
});

const serial = (n: string) => Number(n.split("-")[2]);

describe("takeNumber", () => {
  it.each(["L", "NV", "G"] as const)("gives the admin a number %s-<year>-NNNN, one after another", async (kind) => {
    const a = await takeNumber(kind, w.admin);
    const b = await takeNumber(kind, w.admin);
    expect(a).toMatch(new RegExp(`^${kind}-2026-\\d{4}$`));
    expect(serial(b)).toBe(serial(a) + 1);
  });

  it("counts the kinds separately", async () => {
    const g = await takeNumber("G", w.admin);
    const nv = await takeNumber("NV", w.admin);
    expect(g.startsWith("G-")).toBe(true);
    expect(nv.startsWith("NV-")).toBe(true);
  });

  it("numbers by the year of the calendar of Tashkent, not by the year of the server", async () => {
    w.clock.set(new Date("2026-12-31T19:30:00Z")); // 00:30 on 1 January in Tashkent
    try {
      expect(await takeNumber("G", w.admin)).toBe("G-2027-0001");
    } finally {
      w.clock.set(new Date("2026-10-12T10:00:00+05:00"));
    }
  });

  it("burns no number when the transaction fails: the next one is the same", async () => {
    let taken = "";
    await w.db
      .transaction(async (tx) => {
        taken = await takeNumber("G", w.admin, tx);
        throw new Error("the request failed");
      })
      .catch(() => undefined);
    expect(await takeNumber("G", w.admin)).toBe(taken);
  });

  it("gives the site and the bot lead numbers only, and the worker none", async () => {
    expect(await takeNumber("L", w.web)).toMatch(/^L-2026-/);
    expect(await takeNumber("L", w.bot)).toMatch(/^L-2026-/);
    for (const rt of [w.web, w.bot]) {
      await expect(takeNumber("NV", rt)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(takeNumber("G", rt)).rejects.toBeInstanceOf(ForbiddenError);
    }
    await expect(takeNumber("L", w.worker)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
