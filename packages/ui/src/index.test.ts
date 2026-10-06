import { describe, expect, it } from "vitest";
import * as ui from "./index.ts";

describe("public API of @nivel/ui (core entry)", () => {
  it("keeps the names the apps already import (apps/web layout uses defaultTheme)", () => {
    expect(ui.defaultTheme).toBe("day");
    expect(ui.themes).toEqual(["day", "night"]);
  });

  it("exports tokens, theme logic, fonts and formatting (the react parts are in react.ts)", () => {
    const names = [
      "themeTokens",
      "brand",
      "sceneLight",
      "font",
      "space",
      "radius",
      "motion",
      "resolveTheme",
      "themeByLocalTime",
      "createThemeController",
      "themeInitScript",
      "fontFaces",
      "fontFile",
      "formatAmount",
      "formatBp",
      "badgeKinds",
    ];
    expect(names.filter((n) => !(n in ui))).toEqual([]);
  });
});
