import { NotImplementedError } from "../errors.ts";
import type { Bp, MoneyApi, Rounding, Sum } from "./types.ts";

export type * from "./types.ts";

export function sum(_n: number): Sum {
  throw new NotImplementedError("money.sum");
}
export function bp(_n: number): Bp {
  throw new NotImplementedError("money.bp");
}
export function applyBp(_base: Sum, _rate: Bp, _mode: Rounding): Sum {
  throw new NotImplementedError("money.applyBp");
}
export function roundTo(_value: Sum, _step: number, _mode: Rounding): Sum {
  throw new NotImplementedError("money.roundTo");
}
export function splitByShares(_total: Sum, _shares: readonly Bp[]): Sum[] {
  throw new NotImplementedError("money.splitByShares");
}
export function addSums(..._xs: Sum[]): Sum {
  throw new NotImplementedError("money.addSums");
}

/** Compile-time check: the stubs (and later the implementation) match the frozen contract. */
export const moneyApi = { sum, bp, applyBp, roundTo, splitByShares, addSums } satisfies MoneyApi;
