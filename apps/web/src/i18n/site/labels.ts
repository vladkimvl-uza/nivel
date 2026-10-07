// The dictionary of the scripts of the page: the texts that the background changes while the visitor scrolls (the ruler, the
// captions of the scenes, the sums of the receipts). The server takes the raw text of each key from the messages, fills the
// arguments that are the same for the whole page, and hands the dictionary to the scripts; they fill the rest (`{n}`, `{date}`).
import type { Label } from "./bg-model.ts";

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** Every key the ruler and the scenes of the background may ask for. */
export const BG_LABEL_KEYS: readonly string[] = [
  ...range(0, 6).map((i) => `bg.stage.${i}`),
  "bg.idle.s",
  "bg.idle.ss",
  "bg.route.s",
  "bg.route.ss",
  ...range(1, 6).flatMap((n) => [`route.st${n}.title`, `route.st${n}.doc`, `route.st${n}.stamp`]),
  "bg.x.s",
  "bg.x.ss",
  "bg.y.s",
  "bg.y.ss",
  ...range(0, 7).map((i) => `bg.asm.${i}`),
  "bg.t.s",
  "bg.t.ss",
  "bg.t.done.s",
  "bg.t.done.ss",
  "bg.pas.s",
  "bg.pas.ss",
  "bg.act.s",
  "bg.act.ss",
  "bg.done.s",
  "bg.done.ss",
  "bg.fin.closed.s",
  "bg.fin.closed.ss",
  "bg.fin.closed.st",
  "bg.fin.year.s",
  "bg.fin.year.ss",
  "bg.fin.run.s",
  "bg.fin.run.sCare",
  "bg.fin.run.ss",
  "bg.fin.run.ssCare",
  "bg.fin.care",
  "band.x.label",
  "band.y.label",
  "band.t.label",
  "rc.sum",
  "rc.refund",
];

type Params = Record<string, string | number>;

/** `{name}` → value; an argument that is not given stays as it is. Values are put in as they are (no `$` patterns). */
export function fillLabel(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (whole, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : whole,
  );
}

/** A `Label` over a dictionary; a missing text shows its key, so that a gap is seen and nothing breaks. */
export function makeLabel(dict: Readonly<Record<string, string>>): Label {
  return (key, params) => fillLabel(dict[key] ?? key, params);
}

/** The dictionary: the raw text of each key with the arguments that are known for the whole page filled in. */
export function buildLabels(
  keys: readonly string[],
  raw: (key: string) => string,
  staticParams: Params,
): Record<string, string> {
  return Object.fromEntries(keys.map((k) => [k, fillLabel(raw(k), staticParams)]));
}
