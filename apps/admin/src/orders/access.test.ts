import { describe, expect, it } from "vitest";
import { canDo, ORDERS_NAV, ORDERS_PERMISSIONS, visibleOrdersNav } from "./access.ts";

describe("who may do what in the orders section", () => {
  it("money belongs to the owner only: the assistant and the translator have no money permission", () => {
    const money = [
      "payments.write",
      "quotes.send",
      "orders.settle",
      "reports.write",
      "orders.cancel",
      "registry.write",
      "consents.money",
      "acts.sign",
    ] as const;
    for (const p of money) {
      expect(canDo("owner", p), p).toBe(true);
      expect(canDo("assistant", p), p).toBe(false);
      expect(canDo("translator", p), p).toBe(false);
    }
  });

  it("the assistant works with requests, purchases, assembly, passport and warranty (ARCHITECTURE 6.1)", () => {
    for (const p of [
      "orders.read",
      "leads.work",
      "purchases.write",
      "assembly.write",
      "passport.write",
      "warranty.write",
    ] as const) {
      expect(canDo("assistant", p), p).toBe(true);
    }
  });

  it("the accountant reads the registry and exports it, and changes nothing", () => {
    expect(canDo("accountant", "registry.read")).toBe(true);
    expect(canDo("accountant", "registry.export")).toBe(true);
    for (const [name, roles] of Object.entries(ORDERS_PERMISSIONS)) {
      if (name.endsWith(".read") || name === "registry.export") continue;
      expect(roles as readonly string[], name).not.toContain("accountant");
    }
  });

  it("the translator has nothing here", () => {
    for (const roles of Object.values(ORDERS_PERMISSIONS))
      expect(roles as readonly string[]).not.toContain("translator");
  });
});

describe("the menu", () => {
  it("lists the sections by the permission of the role", () => {
    expect(visibleOrdersNav("owner").map((i) => i.href)).toEqual(["/dashboard", "/leads", "/orders", "/registry"]);
    expect(visibleOrdersNav("assistant").map((i) => i.href)).toEqual(["/dashboard", "/leads", "/orders"]);
    expect(visibleOrdersNav("accountant").map((i) => i.href)).toEqual(["/registry"]);
    expect(visibleOrdersNav("translator")).toEqual([]);
  });
  it("every item of the menu names a permission that exists", () => {
    for (const item of ORDERS_NAV) for (const p of item.anyOf) expect(ORDERS_PERMISSIONS).toHaveProperty(p);
  });
});
