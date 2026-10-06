import { describe, expect, it } from "vitest";
import { can, ForbiddenError, isRole, PERMISSIONS, ROLES, requirePermission, requireRole } from "./roles.ts";

describe("roles", () => {
  it("knows exactly the roles of ARCHITECTURE 6.1", () => {
    expect([...ROLES]).toEqual(["owner", "assistant", "translator", "accountant"]);
    expect(isRole("owner")).toBe(true);
    expect(isRole("root")).toBe(false);
    expect(isRole(undefined)).toBe(false);
  });

  it("the assistant does not see or change money settings, the owner does", () => {
    expect(can("assistant", "settings.money.read")).toBe(false);
    expect(can("assistant", "settings.money.write")).toBe(false);
    expect(can("translator", "settings.money.read")).toBe(false);
    expect(can("owner", "settings.money.read")).toBe(true);
    expect(can("owner", "settings.money.write")).toBe(true);
  });

  it("the accountant only reads", () => {
    for (const [permission, roles] of Object.entries(PERMISSIONS)) {
      if (/\.(write|import|manage)$/.test(permission)) expect(roles as readonly string[]).not.toContain("accountant");
    }
    expect(can("accountant", "settings.money.read")).toBe(true);
  });

  it("the translator has no catalog, no journal and no settings", () => {
    for (const p of ["catalog.read", "catalog.write", "journal.read", "settings.money.read", "users.manage"] as const) {
      expect(can("translator", p)).toBe(false);
    }
    expect(can("translator", "account.self")).toBe(true);
  });

  it("the assistant works with the catalog and uploads but does not manage people or the journal", () => {
    expect(can("assistant", "catalog.write")).toBe(true);
    expect(can("assistant", "upload.write")).toBe(true);
    expect(can("assistant", "users.manage")).toBe(false);
    expect(can("assistant", "journal.read")).toBe(false);
  });

  it("requireRole passes the holder through and refuses everyone else with ForbiddenError", () => {
    const owner = { role: "owner" as const, id: "1" };
    expect(requireRole(owner, ["owner"])).toBe(owner);
    expect(() => requireRole({ role: "assistant" }, ["owner"])).toThrow(ForbiddenError);
    expect(() => requireRole(null, ["owner"])).toThrow(ForbiddenError);
    expect(() => requireRole(undefined, ["owner", "assistant"])).toThrow(/anonymous/);
  });

  it("requirePermission follows the table", () => {
    expect(requirePermission({ role: "owner" }, "settings.money.write").role).toBe("owner");
    const error = (() => {
      try {
        requirePermission({ role: "assistant" }, "settings.money.write");
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(ForbiddenError);
    expect((error as ForbiddenError).code).toBe("forbidden");
    expect((error as ForbiddenError).role).toBe("assistant");
  });
});
