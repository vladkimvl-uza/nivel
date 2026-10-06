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
