// Small checks of input that every scenario shares. They throw ValidationError (4xx for the caller), never TypeError.
import { ValidationError } from "./errors.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export function assertUuid(value: unknown, path: string): string {
  if (!isUuid(value)) throw ValidationError.of(path, "uuid_invalid", `${path} must be an id (uuid)`);
  return value;
}

/** A whole sum from `min` to `max`; the bounds are in the message so that the person sees what to fix. */
export function assertWholeSum(value: unknown, path: string, min = 0, max = 1_000_000_000_000): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw ValidationError.of(path, "sum_invalid", `${path} must be a whole number of sums from ${min} to ${max}`);
  }
  return value;
}

export function assertText(value: unknown, path: string, max: number): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) {
    throw ValidationError.of(path, "text_invalid", `${path} must be a text of 1 to ${max} characters`);
  }
  return value.trim();
}

export function assertInstant(value: unknown, path: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw ValidationError.of(path, "date_invalid", `${path} must be a valid date`);
  }
  return value;
}

/**
 * An instant read by a raw query: drizzle hands timestamps of `execute()` over as text ("2026-10-13 05:00:00+00"),
 * while the query builders map them to Date. Null stays null; text that is not an instant is a broken row.
 */
export function asDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new Error(`a timestamp of the database is not a date: ${String(value)}`);
  return d;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A day of the calendar written 2026-11-02: "2026-02-31" is not one (the parser of the engine would carry it over to March). */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export interface JsonLimits {
  /** Size of the text of the JSON in bytes. */
  maxBytes: number;
  /** Levels of objects and lists; the object itself is level 1. */
  maxDepth: number;
}

function depthOf(v: unknown, limit: number, level = 1): number {
  if (v === null || typeof v !== "object") return level - 1;
  if (level > limit) return level;
  let deepest = level;
  for (const x of Array.isArray(v) ? v : Object.values(v)) deepest = Math.max(deepest, depthOf(x, limit, level + 1));
  return deepest;
}

/** A free JSON object that the public side sends and the database keeps for good: a plain object, small and shallow. */
export function assertJsonObject(value: unknown, path: string, limits: JsonLimits): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw ValidationError.of(path, "json_invalid", `${path} must be an object`);
  }
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    text = undefined;
  }
  if (text === undefined) throw ValidationError.of(path, "json_invalid", `${path} must be plain JSON`);
  if (Buffer.byteLength(text, "utf8") > limits.maxBytes) {
    throw ValidationError.of(path, "json_too_large", `${path} must not exceed ${limits.maxBytes} bytes`);
  }
  if (depthOf(value, limits.maxDepth) > limits.maxDepth) {
    throw ValidationError.of(path, "json_too_deep", `${path} must not nest deeper than ${limits.maxDepth} levels`);
  }
  return value as Record<string, unknown>;
}
