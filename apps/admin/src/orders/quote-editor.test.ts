import { orders } from "@nivel/services";
import { describe, expect, it, vi } from "vitest";
import type { Role } from "../auth/roles.ts";
import { fromFormData } from "./build-event.ts";
import type { Ctx, Svc } from "./commands.ts";
import { SERVICE_FALLBACK } from "./messages.ts";
import { applyChange, type DraftLines, parseChange, parseTasks, type QuoteCtx, rebuildQuote } from "./quote-editor.ts";

const GPU = "0199aaaa-bbbb-7ccc-8ddd-0000000000a1";
const CPU = "0199aaaa-bbbb-7ccc-8ddd-0000000000a2";
const ORDER = "0199aaaa-bbbb-7ccc-8ddd-000000000001";

const empty: DraftLines = { catalog: [], manual: [] };
const form = (entries: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return fromFormData(f);
};

describe("a change to the lines of the estimate", () => {
  it("adds a position, and the same position again adds to the quantity", () => {
    const one = applyChange(empty, { kind: "add", productId: GPU, qty: 1 });
    expect(one).toEqual({
      ok: true,
      lines: { catalog: [{ productId: GPU, qty: 1, customerOwned: false }], manual: [] },
    });
    if (!one.ok) throw new Error("unreachable");
    const two = applyChange(one.lines, { kind: "add", productId: GPU, qty: 2 });
    expect(two).toMatchObject({ ok: true, lines: { catalog: [{ productId: GPU, qty: 3 }] } });
  });

  it("sets the quantity, removes a position, marks it as the customer's own", () => {
    const start: DraftLines = {
      catalog: [
        { productId: GPU, qty: 1, customerOwned: false },
        { productId: CPU, qty: 1, customerOwned: false },
      ],
      manual: [],
    };
    expect(applyChange(start, { kind: "qty", productId: GPU, qty: 2 })).toMatchObject({
      ok: true,
      lines: {
        catalog: [
          { productId: GPU, qty: 2 },
          { productId: CPU, qty: 1 },
        ],
      },
    });
    expect(applyChange(start, { kind: "remove", productId: GPU })).toMatchObject({
      ok: true,
      lines: { catalog: [{ productId: CPU }] },
    });
    expect(applyChange(start, { kind: "owned", productId: CPU })).toMatchObject({
      ok: true,
      lines: {
        catalog: [
          { productId: GPU, customerOwned: false },
          { productId: CPU, customerOwned: true },
        ],
      },
    });
    expect(applyChange(start, { kind: "owned", productId: CPU })).toMatchObject({ ok: true });
  });

  it("refuses to change a position that is not in the estimate", () => {
    for (const change of [
      { kind: "qty", productId: GPU, qty: 2 },
      { kind: "remove", productId: GPU },
      { kind: "owned", productId: GPU },
    ] as const) {
      expect(applyChange(empty, change).ok).toBe(false);
    }
    expect(applyChange(empty, { kind: "removeManual", index: 0 }).ok).toBe(false);
  });

  it("adds a line by hand and removes it by its place", () => {
    const manual = {
      title: "Сборка и тест",
      categoryCode: "cable_mgmt" as const,
      feeGroup: "mount" as const,
      qty: 1,
      unitSum: 300_000,
    };
    const added = applyChange(empty, { kind: "addManual", line: manual });
    expect(added).toEqual({ ok: true, lines: { catalog: [], manual: [manual] } });
    if (!added.ok) throw new Error("unreachable");
    expect(applyChange(added.lines, { kind: "removeManual", index: 0 })).toEqual({ ok: true, lines: empty });
  });

  it("does not change the lines it was given", () => {
    const start: DraftLines = { catalog: [{ productId: GPU, qty: 1, customerOwned: false }], manual: [] };
    const copy = structuredClone(start);
    applyChange(start, { kind: "add", productId: GPU, qty: 4 });
    expect(start).toEqual(copy);
  });
});

describe("reading a change from a form", () => {
  it("reads each kind", () => {
    expect(parseChange(form({ change: "add", productId: GPU, qty: "2" }))).toEqual({
      ok: true,
      change: { kind: "add", productId: GPU, qty: 2 },
    });
    expect(parseChange(form({ change: "add", productId: GPU }))).toEqual({
      ok: true,
      change: { kind: "add", productId: GPU, qty: 1 },
    });
    expect(parseChange(form({ change: "qty", productId: GPU, qty: "3" }))).toMatchObject({ ok: true });
    expect(parseChange(form({ change: "remove", productId: GPU }))).toMatchObject({ ok: true });
    expect(parseChange(form({ change: "owned", productId: GPU }))).toMatchObject({ ok: true });
    expect(parseChange(form({ change: "removeManual", index: "1" }))).toEqual({
      ok: true,
      change: { kind: "removeManual", index: 1 },
    });
    expect(parseChange(form({ change: "recalc" }))).toEqual({ ok: true, change: { kind: "recalc" } });
  });

  it("reads a manual line with a sum typed by a person", () => {
    const r = parseChange(
      form({
        change: "addManual",
        title: " Сборка ",
        categoryCode: "cable_mgmt",
        feeGroup: "mount",
        qty: "1",
        unitSum: "300 000",
      }),
    );
    expect(r).toEqual({
      ok: true,
      change: {
        kind: "addManual",
        line: { title: "Сборка", categoryCode: "cable_mgmt", feeGroup: "mount", qty: 1, unitSum: 300_000 },
      },
    });
  });

  it("marks a manual line that the shop does not buy (works of the owner)", () => {
    const r = parseChange(
      form({
        change: "addManual",
        title: "Работа",
        categoryCode: "cable_mgmt",
        feeGroup: "mount",
        qty: "1",
        unitSum: "100000",
        notPurchased: "on",
      }),
    );
    expect(r).toMatchObject({ ok: true, change: { line: { purchasedByIp: false } } });
  });

  it("refuses what is not a change, an id that is not an id, a quantity that is not a number, a sum with a fraction", () => {
    expect(parseChange(form({})).ok).toBe(false);
    expect(parseChange(form({ change: "nope" })).ok).toBe(false);
    expect(parseChange(form({ change: "add", productId: "x" })).ok).toBe(false);
    expect(parseChange(form({ change: "add", productId: GPU, qty: "two" })).ok).toBe(false);
    expect(parseChange(form({ change: "add", productId: GPU, qty: "0" })).ok).toBe(false);
    expect(
      parseChange(
        form({
          change: "addManual",
          title: "x",
          categoryCode: "cable_mgmt",
          feeGroup: "mount",
          qty: "1",
          unitSum: "1,5",
        }),
      ).ok,
    ).toBe(false);
    expect(
      parseChange(
        form({ change: "addManual", title: "", categoryCode: "cable_mgmt", feeGroup: "mount", qty: "1", unitSum: "5" }),
      ).ok,
    ).toBe(false);
    expect(
      parseChange(
        form({
          change: "addManual",
          title: "x",
          categoryCode: "cable_mgmt",
          feeGroup: "weird",
          qty: "1",
          unitSum: "5",
        }),
      ).ok,
    ).toBe(false);
  });
});

describe("tasks of the build", () => {
  it("reads one or two tasks and drops the unknown", () => {
    expect(parseTasks(form({ tasks: ["gaming", "office"] }))).toEqual(["gaming", "office"]);
    expect(parseTasks(form({ tasks: ["gaming", "hacking"] }))).toEqual(["gaming"]);
    expect(parseTasks(form({}))).toEqual([]);
    expect(parseTasks(form({ tasks: ["gaming", "streaming", "office"] }))).toEqual(["gaming", "streaming"]);
    expect(parseTasks(form({ tasks: ["gaming", "gaming"] }))).toEqual(["gaming"]);
  });
});

function ctxOf(role: Role, draft: DraftLines, svc: Partial<Svc>): QuoteCtx {
  const base: Ctx = {
    user: { id: `${role}-1`, role },
    svc: svc as Svc,
    rt: {} as Ctx["rt"],
    now: () => new Date(),
  };
  return { ...base, drafts: { load: vi.fn(async () => draft) } };
}

describe("rebuilding the estimate", () => {
  const built = { quoteId: "q1", version: 2, totals: {}, compatVerdict: "ok", shelfLifeHours: 24 };

  it("applies the change to the lines of the current draft and asks the services to calculate them", async () => {
    const build = vi.fn(async () => built);
    const draft: DraftLines = { catalog: [{ productId: CPU, qty: 1, customerOwned: false }], manual: [] };
    const ctx = ctxOf("owner", draft, { quotes: { build } } as unknown as Partial<Svc>);
    const r = await rebuildQuote(ctx, ORDER, form({ change: "add", productId: GPU, qty: "1", tasks: ["gaming"] }));
    expect(r.ok).toBe(true);
    expect(build).toHaveBeenCalledWith(
      {
        orderId: ORDER,
        lines: [
          { productId: CPU, qty: 1 },
          { productId: GPU, qty: 1 },
        ],
        tasks: ["gaming"],
      },
      { kind: "owner", id: "owner-1" },
      ctx.rt,
    );
  });

  it("carries the lines of the customer's own parts and the manual lines to the services", async () => {
    const build = vi.fn(async () => built);
    const manual = {
      title: "Работа",
      categoryCode: "cable_mgmt" as const,
      feeGroup: "mount" as const,
      qty: 1,
      unitSum: 5,
      purchasedByIp: false,
    };
    const draft: DraftLines = { catalog: [{ productId: CPU, qty: 1, customerOwned: true }], manual: [manual] };
    const ctx = ctxOf("owner", draft, { quotes: { build } } as unknown as Partial<Svc>);
    await rebuildQuote(ctx, ORDER, form({ change: "recalc" }));
    expect(build).toHaveBeenCalledWith(
      { orderId: ORDER, lines: [{ productId: CPU, qty: 1, customerOwned: true }], manualLines: [manual], tasks: [] },
      expect.anything(),
      ctx.rt,
    );
  });

  it("writes an unexpected exception to the log and shows only the general text", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const failure = new Error("deadlock detected");
      const build = vi.fn(async () => Promise.reject(failure));
      const r = await rebuildQuote(
        ctxOf("owner", empty, { quotes: { build } } as unknown as Partial<Svc>),
        ORDER,
        form({ change: "add", productId: GPU }),
      );
      expect(r).toMatchObject({ ok: false, message: SERVICE_FALLBACK });
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0]?.[1]).toBe(failure);
    } finally {
      log.mockRestore();
    }
  });

  it("is the owner's: the assistant does not change the estimate", async () => {
    const build = vi.fn();
    const r = await rebuildQuote(
      ctxOf("assistant", empty, { quotes: { build } } as unknown as Partial<Svc>),
      ORDER,
      form({ change: "add", productId: GPU }),
    );
    expect(r).toMatchObject({ ok: false, denied: true });
    expect(build).not.toHaveBeenCalled();
  });

  it("says in Russian what the services refused", async () => {
    const build = vi.fn(async () => {
      throw orders.ValidationError.of("lines.x", "no_price", "no price");
    });
    const r = await rebuildQuote(
      ctxOf("owner", empty, { quotes: { build } } as unknown as Partial<Svc>),
      ORDER,
      form({ change: "add", productId: GPU }),
    );
    expect(r.ok).toBe(false);
    expect(r.message).toContain("рыночной цены");
  });

  it("does not call the services for a change that cannot be applied", async () => {
    const build = vi.fn();
    const r = await rebuildQuote(
      ctxOf("owner", empty, { quotes: { build } } as unknown as Partial<Svc>),
      ORDER,
      form({ change: "remove", productId: GPU }),
    );
    expect(r.ok).toBe(false);
    expect(build).not.toHaveBeenCalled();
  });

  it("reports the version and the verdict of the new draft", async () => {
    const build = vi.fn(async () => ({ ...built, compatVerdict: "block" }));
    const r = await rebuildQuote(
      ctxOf("owner", empty, { quotes: { build } } as unknown as Partial<Svc>),
      ORDER,
      form({ change: "add", productId: GPU }),
    );
    expect(r.ok && r.message).toContain("версия 2");
  });
});
