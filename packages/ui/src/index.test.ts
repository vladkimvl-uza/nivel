import { describe, expect, it } from "vitest";
import * as ui from "./index.ts";

describe("public API of @nivel/ui (core entry)", () => {
  it("keeps the names the apps already import (apps/web layout uses defaultTheme) and says night", () => {
    expect(ui.defaultTheme).toBe("night");
    expect(ui.themes).toEqual(["night"]);
  });

  it("exports tokens, fonts and formatting (the react parts are in react.ts)", () => {
    const names = [
      "themeTokens",
      "brand",
      "sceneLight",
      "font",
      "space",
      "radius",
      "motion",
      "fontFaces",
      "fontFile",
      "formatAmount",
      "formatBp",
      "badgeKinds",
    ];
    expect(names.filter((n) => !(n in ui))).toEqual([]);
  });

  it("has no switching logic: no choice by time, no storage, no controller, no init script, no event", () => {
    const removed = [
      "resolveTheme",
      "themeByLocalTime",
      "themeFromSearch",
      "readStoredTheme",
      "storeTheme",
      "isTheme",
      "createThemeController",
      "createBrowserThemeController",
      "createInertThemeController",
      "themeInitScript",
      "THEME_EVENT",
      "THEME_STORAGE_KEY",
      "THEME_SHIFT_CLASS",
      "THEME_SHIFT_MS",
      "DAY_FROM_HOUR",
      "DAY_TO_HOUR",
    ];
    expect(removed.filter((n) => n in ui)).toEqual([]);
  });

  it("has no day-night durations in the motion tokens", () => {
    expect(Object.keys(ui.motion.dur)).toEqual(["fast", "base", "slow"]);
  });
});
