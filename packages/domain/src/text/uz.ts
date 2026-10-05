// Re-exported by packages/i18n (ARCHITECTURE 4.12).
import { NotImplementedError } from "../errors.ts";
import type { UzTextApi } from "./types.ts";

export function normalizeUz(_input: string): string {
  throw new NotImplementedError("text.normalizeUz");
}
export function uzSearchKey(_input: string): string {
  throw new NotImplementedError("text.uzSearchKey");
}

export const uzTextApi = { normalizeUz, uzSearchKey } satisfies UzTextApi;
