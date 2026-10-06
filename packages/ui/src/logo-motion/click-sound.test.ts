import { describe, expect, it } from "vitest";
import { LAMP_CLICK_AT, PEAK_DBFS, renderClickTrack, SAMPLE_RATE, wavBytes } from "./click-sound.ts";
import { AXES, CLICKS, INTRO_DURATION } from "./timeline.ts";

const track = renderClickTrack(3.4);
const at = (t: number) => Math.round(t * SAMPLE_RATE);
/** RMS of a window starting at `t` seconds. */
const rms = (samples: Float32Array, t: number, len = 0.02) => {
  const a = at(t);
  const b = Math.min(samples.length, a + at(len));
  let s = 0;
  for (let i = a; i < b; i++) s += (samples[i] as number) ** 2;
  return Math.sqrt(s / Math.max(1, b - a));
};
/** Share of the energy in the first difference: a rough measure of "brightness". */
const brightness = (samples: Float32Array, t: number, len = 0.03) => {
  const a = at(t);
  const b = a + at(len);
  let e = 0;
  let d = 0;
  for (let i = a + 1; i < b; i++) {
    e += (samples[i] as number) ** 2;
    d += ((samples[i] as number) - (samples[i - 1] as number)) ** 2;
  }
  return d / Math.max(e, 1e-12);
};

describe("renderClickTrack", () => {
  it("has the length of the clip at 48 kHz, mono", () => {
    expect(SAMPLE_RATE).toBe(48000);
    expect(track).toHaveLength(Math.round(3.4 * SAMPLE_RATE));
  });

  it("peaks at -3 dBFS and never clips", () => {
    const peak = track.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    expect(PEAK_DBFS).toBe(-3);
    expect(20 * Math.log10(peak)).toBeCloseTo(-3, 1);
    expect(track.every((v) => Number.isFinite(v) && Math.abs(v) <= 1)).toBe(true);
  });

  it("is silent before the lamp switch and after the last bounce (no tail)", () => {
    expect(rms(track, 0, LAMP_CLICK_AT - 0.002)).toBe(0);
    const lastBounce = (CLICKS.at(-1)?.t ?? 0) + 0.2;
    expect(rms(track, lastBounce, INTRO_DURATION - lastBounce)).toBeLessThan(1e-4);
  });

  it("clicks on each of the five seats: a loud burst right after the seat time", () => {
    for (const c of CLICKS) {
      expect(rms(track, c.t, 0.012)).toBeGreaterThan(0.02);
      expect(rms(track, c.t - 0.03, 0.02)).toBeLessThan(rms(track, c.t, 0.012) / 3);
    }
  });

  it("adds a switch click of the lamp at 0.06 s", () => {
    expect(LAMP_CLICK_AT).toBe(0.06);
    expect(rms(track, LAMP_CLICK_AT, 0.01)).toBeGreaterThan(0.01);
  });

  it("adds micro-clicks of the bounce, quieter than the seat: -14 dB and -23 dB", () => {
    const seat = rms(track, AXES.line.t1, 0.01);
    const first = rms(track, AXES.line.t1 + 0.075, 0.008);
    const second = rms(track, AXES.line.t1 + 0.075 + 0.0315, 0.008);
    expect(first).toBeGreaterThan(seat * 0.05);
    expect(first).toBeLessThan(seat * 0.4);
    expect(second).toBeGreaterThan(0);
    expect(second).toBeLessThan(first);
  });

  it("makes the word lower and heavier than the dot (the dot is higher and drier)", () => {
    expect(brightness(track, AXES.dot.t1, 0.012)).toBeGreaterThan(brightness(track, AXES.word.t1, 0.012));
  });

  it("is deterministic: the same bytes every run (a clip rendered twice is identical)", () => {
    const again = renderClickTrack(3.4);
    expect(Buffer.from(again.buffer).equals(Buffer.from(track.buffer))).toBe(true);
  });

  it("can render a clip shorter than the intro without writing past the end", () => {
    const short = renderClickTrack(0.7);
    expect(short).toHaveLength(Math.round(0.7 * SAMPLE_RATE));
    expect(rms(short, 0.5, 0.05)).toBeGreaterThan(0);
  });
});

describe("wavBytes", () => {
  it("writes a 16-bit PCM mono WAV with a valid header", () => {
    const wav = wavBytes(new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2]), 48000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const text = (o: number, n: number) => String.fromCharCode(...wav.slice(o, o + n));
    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 4)).toBe("WAVE");
    expect(text(12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(text(36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(7 * 2);
    expect(view.getUint32(4, true)).toBe(wav.byteLength - 8);
    // clamped to the 16-bit range
    expect(view.getInt16(44 + 2 * 3, true)).toBe(32767);
    expect(view.getInt16(44 + 2 * 4, true)).toBe(-32768);
    expect(view.getInt16(44 + 2 * 5, true)).toBe(32767);
    expect(view.getInt16(44 + 2 * 1, true)).toBe(16384);
  });
});
