import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "../auth/service.ts";

const state = vi.hoisted(() => ({
  user: null as SessionUser | null,
  audit: [] as Record<string, unknown>[],
  revalidated: [] as string[],
}));
vi.mock("../auth/next.ts", () => ({
  currentUser: async () => state.user,
  requestInfo: async () => ({ ipHash: "h1", ua: null }),
}));
vi.mock("../auth/runtime.ts", () => ({
  getRuntime: () => ({
    audit: {
      append: async (entry: Record<string, unknown>) => {
        state.audit.push(entry);
      },
    },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => state.revalidated.push(p) }));

const { runAction, SESSION_ENDED } = await import("./action-runner.ts");
const { SERVICE_FALLBACK } = await import("./messages.ts");

const owner: SessionUser = {
  id: "u1",
  email: "o@nivel.test",
  role: "owner",
  telegramUserId: null,
  sessionExpiresAt: new Date(),
};
const spec = {
  name: "orders.pay_confirm",
  entity: "sales.payments",
  entityId: "p1",
  revalidate: ["/orders/1", "/registry"],
};

beforeEach(() => {
  state.user = owner;
  state.audit.length = 0;
  state.revalidated.length = 0;
});

describe("the frame of a server action", () => {
  it("answers that the session ended, and does not run the work, when nobody is signed in", async () => {
    state.user = null;
    const work = vi.fn();
    const r = await runAction(spec, work);
    expect(r).toMatchObject({ ok: false, message: SESSION_ENDED });
    expect(work).not.toHaveBeenCalled();
  });

  it("hands the person and the hash of the address to the work and refreshes the pages after a success", async () => {
    const work = vi.fn(async () => ({ ok: true as const, message: "Платёж подтверждён." }));
    const r = await runAction(spec, work);
    expect(r).toMatchObject({ ok: true, message: "Платёж подтверждён." });
    expect(work).toHaveBeenCalledWith(owner, "h1");
    expect(state.revalidated).toEqual(["/orders/1", "/registry"]);
    expect(state.audit).toEqual([]);
  });

  it("does not refresh anything after a refusal, and shows the text of it", async () => {
    const r = await runAction(spec, async () => ({ ok: false as const, message: "Нужен номер чека." }));
    expect(r).toMatchObject({ ok: false, message: "Нужен номер чека." });
    expect(state.revalidated).toEqual([]);
    expect(state.audit).toEqual([]);
  });

  it("journals an attempt of a role that may not, with the role and without the details of the form", async () => {
    const r = await runAction(spec, async () => ({ ok: false as const, message: "Нет прав.", denied: true }));
    expect(r.ok).toBe(false);
    expect(state.audit).toEqual([
      {
        actor: "admin:u1",
        action: "orders.pay_confirm.denied",
        entity: "sales.payments",
        entityId: "p1",
        after: { role: "owner" },
        ipHash: "h1",
      },
    ]);
  });

  it("shows the general text for what nobody expected, and not the error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await runAction(spec, async () => {
      throw new Error("connect ECONNREFUSED 10.1.2.3:5432");
    });
    expect(r).toMatchObject({ ok: false, message: SERVICE_FALLBACK });
    expect(JSON.stringify(r)).not.toContain("ECONNREFUSED");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
