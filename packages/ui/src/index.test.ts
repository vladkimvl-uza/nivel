import { describe, expect, it } from "vitest";
import * as ui from "./index.ts";

describe("public API of @nivel/ui", () => {
  it("keeps the names the apps already import (apps/web layout uses defaultTheme)", () => {
    expect(ui.defaultTheme).toBe("day");
    expect(ui.themes).toEqual(["day", "night"]);
  });

  it("exports tokens, theme logic, fonts, formatting and every primitive", () => {
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
      "ThemeProvider",
      "useTheme",
      "ThemeToggle",
      "ThemeInitScript",
      "fontFaces",
      "formatAmount",
      "formatBp",
      "Button",
      "TextField",
      "Select",
      "Money",
      "EstimateRow",
      "EstimateTable",
      "SumsTable",
      "Stamp",
      "RoundStamp",
      "StampInkDefs",
      "Tag",
      "Badge",
      "Paper",
    ];
    expect(names.filter((n) => !(n in ui))).toEqual([]);
  });
});
