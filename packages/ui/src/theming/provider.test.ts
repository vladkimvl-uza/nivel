import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { findAll, render } from "../test-support/render.ts";
import type { ThemeController } from "./controller.ts";
import { type ThemeContextValue, ThemeProvider, useTheme } from "./ThemeProvider.tsx";
import { ThemeToggle, ThemeToggleView } from "./ThemeToggle.tsx";

function fakeController(initial: "day" | "night" = "day"): ThemeController & { calls: string[] } {
  let theme = initial;
  const calls: string[] = [];
  return {
    calls,
    init: () => theme,
    get: () => theme,
    getServer: () => "day",
    set: (t) => {
      calls.push(`set:${t}`);
      theme = t;
    },
    toggle: () => {
      theme = theme === "day" ? "night" : "day";
      calls.push(`toggle:${theme}`);
      return theme;
    },
    subscribe: () => () => {},
  };
}

/** Renders `children` inside a provider and hands back the context value the children saw. */
function probe(controller: ThemeController, children?: (v: ThemeContextValue) => ReactNode) {
  let seen: ThemeContextValue | undefined;
  const Probe = () => {
    seen = useTheme();
    return children ? children(seen) : null;
  };
  const html = render(createElement(ThemeProvider, { controller }, createElement(Probe)));
  return { html, value: seen as ThemeContextValue };
}

describe("ThemeProvider", () => {
  it("serves the server snapshot (day) on the server, so that hydration matches the markup", () => {
    const { value } = probe(fakeController("night"));
    expect(value.theme).toBe("day");
  });

  it("hands setTheme and toggleTheme to the controller", () => {
    const c = fakeController();
    const { value } = probe(c);
    value.setTheme("night");
    value.toggleTheme();
    expect(c.calls).toEqual(["set:night", "toggle:day"]);
  });

  it("falls back to an inert controller when there is no document (server render without a controller)", () => {
    const html = render(createElement(ThemeProvider, {}, createElement("p", {}, "ok")));
    expect(html).toBe("<p>ok</p>");
  });

  it("useTheme outside of a provider is a programming error with a clear message", () => {
    const Bad = () => {
      useTheme();
      return null;
    };
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(createElement(Bad))).toThrow(/ThemeProvider/);
    quiet.mockRestore();
  });
});

describe("ThemeToggleView", () => {
  const labels = { group: "Тема", day: "День", night: "Ночь" };

  it("is a group of two buttons with aria-pressed and accessible names (no emoji)", () => {
    const html = render(createElement(ThemeToggleView, { theme: "night", onSelect: () => {}, labels }));
    expect(html).toContain("<fieldset");
    expect(html).toContain('aria-label="Тема"');
    expect(html).toMatch(
      /<button[^>]*aria-label="День"[^>]*aria-pressed="false"|<button[^>]*aria-pressed="false"[^>]*aria-label="День"/,
    );
    expect(html).toMatch(
      /<button[^>]*aria-label="Ночь"[^>]*aria-pressed="true"|<button[^>]*aria-pressed="true"[^>]*aria-label="Ночь"/,
    );
    expect(html.match(/<svg/g)).toHaveLength(2);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}☀-➿]/u);
  });

  it("calls onSelect with the theme of the pressed button", () => {
    const picked: string[] = [];
    const tree = ThemeToggleView({ theme: "day", onSelect: (t) => picked.push(t), labels });
    const buttons = findAll(tree, (el) => el.type === "button");
    expect(buttons).toHaveLength(2);
    for (const b of buttons) (b.props.onClick as () => void)();
    expect(picked).toEqual(["day", "night"]);
  });
});

describe("ThemeToggle (connected)", () => {
  it("shows the pressed state of the current theme from the provider", () => {
    const html = render(
      createElement(
        ThemeProvider,
        { controller: fakeController("day") },
        createElement(ThemeToggle, { labels: { group: "Mavzu", day: "Kun", night: "Tun" } }),
      ),
    );
    expect(html).toContain('aria-label="Kun"');
    expect(html).toMatch(/aria-pressed="true"/);
  });
});
