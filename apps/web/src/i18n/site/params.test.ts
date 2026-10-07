import { describe, expect, it } from "vitest";
import { DEFAULT_FEE_SCALE } from "./fee-scale.ts";
import { priceParams } from "./params.ts";

const NB = " ";

describe("priceParams: the numbers of the price list as words of the texts", () => {
  const ru = priceParams(DEFAULT_FEE_SCALE, "ru");
  const uz = priceParams(DEFAULT_FEE_SCALE, "uz");

  it("writes the scale", () => {
    expect(ru).toMatchObject({
      lowRate: `15${NB}%`,
      highRate: `10${NB}%`,
      mountRate: `15${NB}%`,
      threshold: `20${NB}млн`,
      minFee: `3${NB}млн`,
      noJump: `30${NB}млн`,
    });
    expect(uz).toMatchObject({ threshold: `20${NB}mln`, minFee: `3${NB}mln`, noJump: `30${NB}mln` });
  });

  it("writes the payment in parts and the reserve", () => {
    expect(ru).toMatchObject({ advance: `30${NB}%`, final: `70${NB}%`, reserve: `3–5${NB}%`, hours: 24 });
  });

  it("writes the minimum estimates", () => {
    expect(ru).toMatchObject({ minPc: `6,7${NB}млн`, minSetup: `13,3${NB}млн`, minFree: `4,5${NB}млн` });
  });

  it("writes the shares of the stages", () => {
    expect(ru).toMatchObject({
      selection: `20${NB}%`,
      purchase: `30${NB}%`,
      assembly: `35${NB}%`,
      handover: `15${NB}%`,
    });
  });

  it("writes the date of the price list as dd.mm.yyyy", () => {
    expect(ru.date).toBe("05.10.2026");
    expect(priceParams({ ...DEFAULT_FEE_SCALE, effectiveFrom: "2026-12-01" }, "uz").date).toBe("01.12.2026");
  });

  it("writes the chart: from 5 to 60 million, from 0.75 to 6 million", () => {
    expect(ru).toMatchObject({
      chartFrom: `5${NB}млн`,
      chartTo: `60${NB}млн`,
      feeFrom: `0,75${NB}млн`,
      feeTo: `6${NB}млн`,
    });
  });

  it("writes the sample order of the note of the second step", () => {
    expect(ru.parts).toBe(`26,83${NB}млн${NB}сум`);
    expect(uz.parts).toBe(`26,83${NB}mln${NB}soʻm`);
    expect(ru.fee).toBe(`3${NB}млн`);
    // the border of the minimum: from the threshold to the end of the minimum
    expect(ru.from).toBe(`20${NB}млн`);
    expect(ru.to).toBe(`30${NB}млн`);
  });

  it("follows the setting of the owner", () => {
    const p = priceParams({ ...DEFAULT_FEE_SCALE, pcLowRateBp: 1400, pcThreshold: 21_000_000, advanceBp: 4000 }, "ru");
    expect(p).toMatchObject({ lowRate: `14${NB}%`, threshold: `21${NB}млн`, advance: `40${NB}%`, final: `60${NB}%` });
  });

  it("keeps the refund of the sample order in whole sums", () => {
    expect(ru.refund).toBe(`140${NB}000${NB}сум`);
    expect(uz.refund).toBe(`140${NB}000${NB}soʻm`);
  });
});
