// The small seams of the orders screens with the rest of the admin: the switches, the guards of pages, the services runtime.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "../auth/service.ts";

const state = vi.hoisted(() => ({
  user: null as SessionUser | null,
  setting: undefined as { value: unknown } | undefined,
  admin: {} as Record<string, unknown>,
}));
class Redirect extends Error {
  constructor(readonly to: string) {
    super(to);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));
vi.mock("../auth/next.ts", () => ({
  SIGN_IN_PATH: "/sign-in",
  FORBIDDEN_PATH: "/forbidden",
  currentUser: async () => state.user,
}));
vi.mock("@nivel/db/repos", async (importActual) => ({
  ...(await importActual<typeof import("@nivel/db/repos")>()),
  ops: { getSetting: async () => state.setting ?? null },
}));
vi.mock("../auth/runtime.ts", () => ({ getRuntime: () => state.admin }));

const { featureOn, PDF_FLAG } = await import("./flags.ts");
const { requireOrdersUser, requireSignedIn } = await import("./next.ts");
const { ordersCtx, quoteCtx, servicesRuntime, writerFor } = await import("./runtime.ts");

const user = (role: SessionUser["role"]): SessionUser => ({
  id: "u1",
  email: "u@nivel.test",
  role,
  telegramUserId: null,
  sessionExpiresAt: new Date(),
});

beforeEach(() => {
  state.user = user("owner");
  state.setting = undefined;
  state.admin = {
    db: { marker: "db-1", $client: { query: async () => ({ rows: [] }) } },
    env: { APP_MODE: "development" },
    audit: { append: async () => undefined },
  };
  (globalThis as unknown as Record<symbol, unknown>)[Symbol.for("nivel.admin.orders.services")] = undefined;
});

describe("the switches", () => {
  it("is on only for a setting that is exactly true", async () => {
    expect(PDF_FLAG).toBe("feature.pdf");
    expect(await featureOn({} as never, PDF_FLAG)).toBe(false);
    for (const value of [false, "true", 1, null, {}]) {
      state.setting = { value };
      expect(await featureOn({} as never, PDF_FLAG), JSON.stringify(value)).toBe(false);
    }
    state.setting = { value: true };
    expect(await featureOn({} as never, PDF_FLAG)).toBe(true);
  });
});

describe("the guards of the pages", () => {
  it("send nobody to the sign-in page, and a person without the right to the page that says so", async () => {
    state.user = null;
    await expect(requireOrdersUser(["orders.read"])).rejects.toMatchObject({ to: "/sign-in" });
    await expect(requireSignedIn()).rejects.toMatchObject({ to: "/sign-in" });
    state.user = user("translator");
    await expect(requireOrdersUser(["orders.read"])).rejects.toMatchObject({ to: "/forbidden" });
    await expect(requireSignedIn()).resolves.toMatchObject({ role: "translator" });
  });

  it("let a role through when any of the permissions is its own", async () => {
    state.user = user("accountant");
    await expect(requireOrdersUser(["orders.read", "registry.read"])).resolves.toMatchObject({ role: "accountant" });
    state.user = user("assistant");
    await expect(requireOrdersUser(["registry.read"])).rejects.toMatchObject({ to: "/forbidden" });
  });
});

describe("the services on the connection of the admin", () => {
  it("makes one runtime of the admin role for one database handle, and a new one for another", () => {
    const first = servicesRuntime();
    expect(first.role).toBe("admin");
    expect(first.appMode).toBe("development");
    expect(servicesRuntime()).toBe(first);
    state.admin = { ...state.admin, db: { marker: "db-2", $client: { query: async () => ({ rows: [] }) } } };
    expect(servicesRuntime()).not.toBe(first);
  });

  it("gives the commands the person, the services and the clock of the runtime", () => {
    const ctx = ordersCtx(user("assistant"));
    expect(ctx.user).toEqual({ id: "u1", role: "assistant" });
    expect(ctx.rt).toBe(servicesRuntime());
    expect(typeof ctx.svc.orders.dispatch).toBe("function");
    expect(ctx.now()).toBeInstanceOf(Date);
  });

  it("gives the editor a reader of the draft on the same database", async () => {
    const ctx = quoteCtx(user("owner"));
    expect(await ctx.drafts.load("0199aaaa-bbbb-7ccc-8ddd-000000000001")).toEqual({ catalog: [], manual: [] });
  });

  it("gives the writes the database, the journal, the person and the address hash", () => {
    const w = writerFor(user("owner"), "hash");
    expect(w.user).toEqual({ id: "u1", role: "owner" });
    expect(w.ipHash).toBe("hash");
    expect(w.db).toBe(state.admin.db);
    expect(w.audit).toBe(state.admin.audit);
    expect(w.now()).toBeInstanceOf(Date);
  });
});
