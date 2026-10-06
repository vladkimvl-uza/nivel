import { describe, expect, it } from "vitest";
import { checkUzString, suggest } from "../check-uz-text.mjs";

describe("check-uz-text", () => {
  it("catches o'zbek with U+0027", () => {
    const problems = checkUzString("uz/common.json lang.uz", "o'zbek tili");
    expect(problems).toEqual(['uz/common.json lang.uz: "o\'zbek" has U+0027 inside a word; use "oʻzbek"']);
  });

  it("catches U+2019 and suggests U+02BC after other letters", () => {
    expect(checkUzString("k", "ma’lumot")).toHaveLength(1);
    expect(suggest("ma’lumot")).toBe("maʼlumot");
    expect(suggest("g'isht")).toBe("gʻisht");
  });

  it("accepts correct Uzbek letters", () => {
    expect(checkUzString("k", "Oʻzbekcha, yigʻib, maʼlumot")).toEqual([]);
  });
});
