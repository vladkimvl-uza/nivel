import { describe, expect, it } from "vitest";
import { MOTION_COOKIE, motionCookie, readMotionPrefs } from "./prefs.ts";

describe("readMotionPrefs", () => {
  it("is calm by default", () => {
    expect(readMotionPrefs(undefined, null)).toEqual({ motionOff: false, saveData: false, reduced: false });
  });

  it("takes the switch of the site and the header of the browser", () => {
    expect(readMotionPrefs("off", null)).toEqual({ motionOff: true, saveData: false, reduced: true });
    expect(readMotionPrefs(undefined, "on")).toEqual({ motionOff: false, saveData: true, reduced: true });
    expect(readMotionPrefs(undefined, " ON ").saveData).toBe(true);
  });

  it("takes nothing else for a yes", () => {
    for (const cookie of ["on", "", "OFF", "1", "off "]) expect(readMotionPrefs(cookie, "off").reduced).toBe(false);
  });

  it("names the cookie", () => {
    expect(MOTION_COOKIE).toBe("nv-motion");
  });
});

describe("motionCookie", () => {
  it("sets the switch for a year, for the whole site, and takes it away again", () => {
    expect(motionCookie(true)).toBe("nv-motion=off; path=/; max-age=31536000; samesite=lax");
    expect(motionCookie(false)).toBe("nv-motion=; path=/; max-age=0; samesite=lax");
  });

  it("is read back by readMotionPrefs", () => {
    const value = /^nv-motion=([^;]*)/.exec(motionCookie(true))?.[1];
    expect(readMotionPrefs(value, null).motionOff).toBe(true);
  });
});
