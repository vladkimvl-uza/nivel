import { describe, expect, it } from "vitest";
import { bgVideoAllowed, decideGate, heroMode, posterSize } from "./motion-gate.ts";

const calm = { motionOff: false, prefersReduced: false, saveData: false };

describe("decideGate: video or posters", () => {
  it("lets the video play on a normal connection and device", () => {
    expect(decideGate({ ...calm, effectiveType: "4g", downlink: 10, deviceMemory: 8 })).toEqual({
      ok: true,
      why: "ok",
    });
    expect(decideGate(calm)).toEqual({ ok: true, why: "ok" });
  });

  it("stops the video for a visitor who wants less motion, by the system or by the switch of the site", () => {
    expect(decideGate({ ...calm, prefersReduced: true })).toEqual({ ok: false, why: "reduced-motion" });
    expect(decideGate({ ...calm, motionOff: true })).toEqual({ ok: false, why: "reduced-motion" });
  });

  it("stops the video when the browser saves traffic", () => {
    expect(decideGate({ ...calm, saveData: true })).toEqual({ ok: false, why: "save-data" });
  });

  it.each([["slow-2g"], ["2g"], ["3g"]])("stops the video on a %s connection", (effectiveType) => {
    expect(decideGate({ ...calm, effectiveType })).toEqual({ ok: false, why: "slow-net" });
  });

  it("stops the video on a thin channel even when the type is not 4g, but not when the type is 4g", () => {
    expect(decideGate({ ...calm, effectiveType: "5g", downlink: 1.5 })).toEqual({ ok: false, why: "slow-net" });
    expect(decideGate({ ...calm, effectiveType: "4g", downlink: 1.5 })).toEqual({ ok: true, why: "ok" });
    expect(decideGate({ ...calm, effectiveType: "wifi", downlink: 20 })).toEqual({ ok: true, why: "ok" });
  });

  it("stops the video on a device with less than 2 GB", () => {
    expect(decideGate({ ...calm, deviceMemory: 1 })).toEqual({ ok: false, why: "weak-device" });
    expect(decideGate({ ...calm, deviceMemory: 0.5 })).toEqual({ ok: false, why: "weak-device" });
    expect(decideGate({ ...calm, deviceMemory: 2 })).toEqual({ ok: true, why: "ok" });
  });

  it("names the first reason when there are several", () => {
    expect(decideGate({ motionOff: true, prefersReduced: true, saveData: true, effectiveType: "2g" }).why).toBe(
      "reduced-motion",
    );
    expect(decideGate({ ...calm, saveData: true, effectiveType: "2g" }).why).toBe("save-data");
  });
});

describe("heroMode", () => {
  it("is static for a visitor who wants less motion, posters when only the video is not allowed, video otherwise", () => {
    expect(heroMode({ ok: true, why: "ok" }, false)).toBe("video");
    expect(heroMode({ ok: false, why: "slow-net" }, false)).toBe("posters");
    expect(heroMode({ ok: false, why: "save-data" }, false)).toBe("posters");
    expect(heroMode({ ok: false, why: "reduced-motion" }, true)).toBe("reduced");
  });
});

describe("bgVideoAllowed: the videos of the background", () => {
  const base = { reduced: false, gateOk: true, small: false, deviceMemory: undefined };

  it("plays on a desktop that passed the gate", () => {
    expect(bgVideoAllowed(base)).toBe(true);
  });

  it("never plays under reduced motion or when the gate says no", () => {
    expect(bgVideoAllowed({ ...base, reduced: true })).toBe(false);
    expect(bgVideoAllowed({ ...base, gateOk: false })).toBe(false);
  });

  it("wants 4 GB on a phone, and takes the phone with unknown memory as having 4", () => {
    expect(bgVideoAllowed({ ...base, small: true, deviceMemory: 2 })).toBe(false);
    expect(bgVideoAllowed({ ...base, small: true, deviceMemory: 3 })).toBe(false);
    expect(bgVideoAllowed({ ...base, small: true, deviceMemory: 4 })).toBe(true);
    expect(bgVideoAllowed({ ...base, small: true, deviceMemory: undefined })).toBe(true);
  });

  it("does not ask a desktop for more than the gate asks", () => {
    expect(bgVideoAllowed({ ...base, deviceMemory: 2 })).toBe(true);
  });
});

describe("posterSize", () => {
  it("uses the vertical montage on a phone or a coarse pointer", () => {
    expect(posterSize({ width: 390, dpr: 3, coarse: true })).toBe("m");
    expect(posterSize({ width: 800, dpr: 1, coarse: false })).toBe("m");
    expect(posterSize({ width: 1440, dpr: 1, coarse: true })).toBe("m");
  });

  it("uses 1920 only on a wide screen with a dense pixel grid", () => {
    expect(posterSize({ width: 1440, dpr: 1, coarse: false })).toBe("1280");
    expect(posterSize({ width: 1920, dpr: 1, coarse: false })).toBe("1280");
    expect(posterSize({ width: 1600, dpr: 2, coarse: false })).toBe("1920");
    expect(posterSize({ width: 1599, dpr: 2, coarse: false })).toBe("1280");
  });
});
