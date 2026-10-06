import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { first, listHref, Pager } from "./Pager.tsx";

describe("listHref", () => {
  it("keeps the filters that are set and drops the empty ones", () => {
    expect(listHref("/catalog", { category: "gpu", q: "", status: undefined, page: "2" })).toBe(
      "/catalog?category=gpu&page=2",
    );
    expect(listHref("/catalog", {})).toBe("/catalog");
  });

  it("encodes what a person typed", () => {
    expect(listHref("/journal", { actor: "admin:1 & co", q: "а б" })).toBe(
      "/journal?actor=admin%3A1+%26+co&q=%D0%B0+%D0%B1",
    );
  });
});

describe("first", () => {
  it("takes the first of repeated parameters", () => {
    expect(first(["a", "b"])).toBe("a");
    expect(first("c")).toBe("c");
    expect(first(undefined)).toBeUndefined();
  });
});

describe("Pager", () => {
  const html = (page: number, pages: number) =>
    renderToStaticMarkup(createElement(Pager, { page, pages, total: 120, hrefFor: (n: number) => `/x?page=${n}` }));

  it("links to the neighbours that exist and says where we are", () => {
    const middle = html(2, 5);
    expect(middle).toContain('<a href="/x?page=1">← Назад</a>');
    expect(middle).toContain('<a href="/x?page=3">Вперёд →</a>');
    expect(middle).toContain("Страница 2 из 5 · всего 120");
  });

  it("has no link before the first page and after the last", () => {
    expect(html(1, 5)).not.toContain("← Назад</a>");
    expect(html(5, 5)).not.toContain("Вперёд →</a>");
    expect(html(1, 1)).not.toContain("<a ");
  });
});
