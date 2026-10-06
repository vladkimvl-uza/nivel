// The click of a part seating in its pocket, for the clips only (Reels, the bot): the site has no sound.
// Synthesized, so there is nothing to license and the track is the same every run. A real recording of an aluminium
// part in a milled pocket would be better for advertising (concept notes, risks); this is a stand-in with the same timing.
//
// A click: a differentiated noise transient of 0.7 ms, four decaying tones at 2.4-8.8 kHz (2-11 ms) and a short
// "body" at 150 Hz (16 ms). The word is lower and heavier, the dot higher and drier. Every bounce adds micro-clicks
// (-14 and -23 dB). Early reflections of a small room, no tail. Peak -3 dBFS. The lamp switch clicks at 0.06 s.
import { AXES, PART_IDS, type PartId } from "./timeline.ts";

export const SAMPLE_RATE = 48000;
export const PEAK_DBFS = -3;
export const LAMP_CLICK_AT = 0.06;

interface Voice {
  /** Multiplies the frequency of the tones. */
  pitch: number;
  /** Gain of the 150 Hz body. */
  body: number;
  /** Multiplies the decay times. */
  decay: number;
}

const VOICE: Record<PartId, Voice> = {
  line: { pitch: 1, body: 1, decay: 1 },
  tri: { pitch: 1.12, body: 0.8, decay: 0.9 },
  shelf: { pitch: 1.04, body: 0.95, decay: 1.05 },
  word: { pitch: 0.7, body: 1.3, decay: 1.35 },
  dot: { pitch: 1.4, body: 0.55, decay: 0.7 },
};
const TONES = [
  { hz: 2400, ms: 11, gain: 1 },
  { hz: 4100, ms: 7, gain: 0.7 },
  { hz: 6300, ms: 4, gain: 0.5 },
  { hz: 8800, ms: 2, gain: 0.35 },
];
/** Early reflections of a small room: delay in ms and gain. */
const ROOM = [
  { ms: 3.1, gain: 0.28 },
  { ms: 5.7, gain: 0.18 },
  { ms: 8.3, gain: 0.1 },
];
/** The first two hops of the bounce end in a micro-click: time after the seat (s), gain in dB. */
const MICRO = [
  { after: 0.075, db: -14 },
  { after: 0.075 + 0.0315, db: -23 },
];

const dB = (v: number) => 10 ** (v / 20);

/** Park-Miller generator: the same noise every run. */
function noise(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s / 2147483647) * 2 - 1;
  };
}

function click(out: Float32Array, t: number, voice: Voice, gain: number, seed: number) {
  const start = Math.round(t * SAMPLE_RATE);
  const n = noise(seed);
  const add = (i: number, v: number) => {
    if (i < 0 || i >= out.length) return;
    out[i] = (out[i] as number) + v;
  };
  const sound = (i: number) => {
    const x = i / SAMPLE_RATE;
    let v = 0;
    // transient: differentiated noise, 0.7 ms
    if (x < 0.0007) {
      v += (n() - n()) * 0.9 * (1 - x / 0.0007);
    }
    for (const tone of TONES) {
      v +=
        tone.gain * Math.sin(2 * Math.PI * tone.hz * voice.pitch * x) * Math.exp(-x / ((tone.ms * voice.decay) / 3000));
    }
    v += 0.5 * voice.body * Math.sin(2 * Math.PI * 150 * x) * Math.exp(-x / (0.016 / 3));
    return v * gain;
  };
  const length = Math.round(0.06 * SAMPLE_RATE);
  for (let i = 0; i < length; i++) {
    const v = sound(i);
    add(start + i, v);
    for (const r of ROOM) add(start + i + Math.round((r.ms / 1000) * SAMPLE_RATE), v * r.gain);
  }
}

/** A dull "thunk" of the lamp switch. */
function lampSwitch(out: Float32Array, t: number) {
  const start = Math.round(t * SAMPLE_RATE);
  const n = noise(99);
  const length = Math.round(0.02 * SAMPLE_RATE);
  for (let i = 0; i < length; i++) {
    const x = i / SAMPLE_RATE;
    const v = (n() * 0.5 + Math.sin(2 * Math.PI * 900 * x)) * Math.exp(-x / 0.002) * 0.6;
    const k = start + i;
    if (k >= 0 && k < out.length) out[k] = (out[k] as number) + v;
  }
}

/** The click track of the intro for a clip of `seconds`: mono Float32, peak -3 dBFS. */
export function renderClickTrack(seconds: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  lampSwitch(out, LAMP_CLICK_AT);
  PART_IDS.forEach((id, index) => {
    const t1 = AXES[id].t1;
    click(out, t1, VOICE[id], 1, 1000 + index * 17);
    MICRO.forEach((m, k) => {
      click(out, t1 + m.after, VOICE[id], dB(m.db), 5000 + index * 31 + k);
    });
  });
  const peak = out.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
  if (peak > 0) {
    const k = dB(PEAK_DBFS) / peak;
    for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) * k;
  }
  return out;
}

/** 16-bit PCM mono WAV file bytes of the samples (clamped to -1..1). */
export function wavBytes(samples: Float32Array, rate: number): Uint8Array {
  const data = samples.length * 2;
  const bytes = new Uint8Array(44 + data);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + data, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, data, true);
  samples.forEach((v, i) => {
    const c = Math.max(-1, Math.min(1, v));
    view.setInt16(44 + i * 2, c < 0 ? Math.round(c * 32768) : Math.round(c * 32767), true);
  });
  return bytes;
}
