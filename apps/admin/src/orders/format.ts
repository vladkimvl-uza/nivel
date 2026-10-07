// Display formatting of the admin (Russian only, Asia/Tashkent). Nothing here calculates money: a sum is shown as it
// was stored, basis points are written as percent by integer arithmetic.
const NBSP = " ";

/** "12 500 000 сум": whole sums only. A missing sum is a dash. */
export function formatSum(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (!Number.isSafeInteger(value)) throw new RangeError(`a sum must be a whole number, got ${value}`);
  const digits = String(Math.abs(value)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${value < 0 ? "−" : ""}${digits}${NBSP}сум`;
}

/** 1500 -> "15 %", 6050 -> "60,5 %": basis points with at most two decimals. */
export function formatBp(bp: number): string {
  if (!Number.isSafeInteger(bp)) throw new RangeError(`basis points must be a whole number, got ${bp}`);
  const whole = Math.trunc(bp / 100);
  const frac = Math.abs(bp % 100);
  if (frac === 0) return `${whole} %`;
  const tail = String(frac).padStart(2, "0").replace(/0$/, "");
  return `${bp < 0 && whole === 0 ? "−" : ""}${whole},${tail} %`;
}

const parts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Tashkent",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function wall(at: Date): { y: string; m: string; d: string; h: string; min: string } {
  const p = Object.fromEntries(parts.formatToParts(at).map((x) => [x.type, x.value]));
  return { y: p.year ?? "", m: p.month ?? "", d: p.day ?? "", h: p.hour ?? "", min: p.minute ?? "" };
}

export function formatDateTime(at: Date | null | undefined): string {
  if (!at) return "—";
  const w = wall(at);
  return `${w.d}.${w.m}.${w.y} ${w.h}:${w.min}`;
}

/** A moment or a day written 2026-10-12, as 12.10.2026. */
export function formatDate(at: Date | string | null | undefined): string {
  if (at === null || at === undefined) return "—";
  if (typeof at === "string") return at.split("-").reverse().join(".");
  const w = wall(at);
  return `${w.d}.${w.m}.${w.y}`;
}

/** The day of the calendar of Tashkent as 2026-10-12. */
export function tashkentDay(at: Date): string {
  const w = wall(at);
  return `${w.y}-${w.m}-${w.d}`;
}
