import { describe, expect, it } from "vitest";
import { ROLES } from "../auth/roles.ts";
import { breadcrumbs, canOpen, homeFor, NAV_ITEMS, visibleNav } from "./nav.ts";

describe("menu by role", () => {
  it("the owner sees every section of this package", () => {
    expect(visibleNav("owner").map((i) => i.href)).toEqual([
      "/catalog",
      "/settings",
      "/journal",
      "/files",
      "/users",
      "/account",
    ]);
  });

  it("the assistant sees the catalog (to read), the calendar, files and the own account, not money, journal or people", () => {
    expect(visibleNav("assistant").map((i) => i.href)).toEqual(["/catalog", "/settings", "/files", "/account"]);
  });

  it("the translator has only the own account", () => {
    expect(visibleNav("translator").map((i) => i.href)).toEqual(["/account"]);
  });

  it("the accountant reads the catalog, the settings and the journal", () => {
    expect(visibleNav("accountant").map((i) => i.href)).toEqual(["/catalog", "/settings", "/journal", "/account"]);
  });

  it("every item has a Russian title and a unique address", () => {
    const hrefs = NAV_ITEMS.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const item of NAV_ITEMS) expect(item.label).toMatch(/[а-яА-Я]/);
  });

  it("the first screen of each role is the first item of its menu", () => {
    expect(homeFor("owner")).toBe("/catalog");
    expect(homeFor("translator")).toBe("/account");
    for (const role of ROLES) expect(homeFor(role)).toBe(visibleNav(role)[0]?.href);
  });
});

describe("canOpen: the same rule for a menu link typed by hand", () => {
  it("follows the permission of the section, for the section and everything below it", () => {
    expect(canOpen("assistant", "/settings")).toBe(true);
    expect(canOpen("assistant", "/settings/money")).toBe(false);
    expect(canOpen("owner", "/settings/money")).toBe(true);
    expect(canOpen("accountant", "/settings/money")).toBe(true);
    expect(canOpen("translator", "/catalog")).toBe(false);
    expect(canOpen("translator", "/catalog/abc/edit")).toBe(false);
    expect(canOpen("assistant", "/catalog/import")).toBe(false);
    expect(canOpen("owner", "/catalog/import")).toBe(true);
    expect(canOpen("assistant", "/journal")).toBe(false);
    expect(canOpen("translator", "/account")).toBe(true);
  });

  it("an address that belongs to nobody is closed, a lookalike prefix too", () => {
    expect(canOpen("owner", "/nothing")).toBe(false);
    expect(canOpen("owner", "/catalogue")).toBe(false);
    expect(canOpen("owner", "/")).toBe(false);
    expect(canOpen("owner", "/settings/../journal")).toBe(false);
  });

  it("login and health are open to everyone", () => {
    expect(canOpen(null, "/sign-in")).toBe(true);
    expect(canOpen(null, "/healthz")).toBe(true);
    expect(canOpen(null, "/catalog")).toBe(false);
  });
});

describe("breadcrumbs", () => {
  it("names the section and the page", () => {
    expect(breadcrumbs("/settings/money")).toEqual([
      { href: "/settings", label: "Настройки" },
      { href: "/settings/money", label: "Деньги" },
    ]);
    expect(breadcrumbs("/catalog")).toEqual([{ href: "/catalog", label: "Каталог" }]);
    expect(breadcrumbs("/catalog/import")).toEqual([
      { href: "/catalog", label: "Каталог" },
      { href: "/catalog/import", label: "Импорт из файла" },
    ]);
    expect(breadcrumbs("/unknown")).toEqual([]);
  });
});
