// ARCHITECTURE 4.1: defaults of the domain match the owner's documents, and a test compares them.
import { describe, expect, it } from "vitest";
import { readRepoFile } from "../money/testkit.ts";
import { TAX_RISK_RESERVE_BP, WARRANTY_RESERVE } from "../reserve/index.ts";
import { DEFAULT_THRESHOLD_SETTINGS } from "../threshold/index.ts";
import { DEFAULT_FEE_SETTINGS as D } from "./index.ts";

const doc = (file: string): string => readRepoFile(expect.getState().testPath, `docs/${file}`).replace(/\s+/g, " ");
const decisions = doc("DECISIONS.md");
const concept = doc("CONCEPT.md");
const architecture = doc("ARCHITECTURE.md");

/** DECISIONS table row of a decision, e.g. "Р-8". */
const row = (id: string): string => {
  const m = new RegExp(`\\| ${id} \\|[^|]*\\|[^|]*\\|`).exec(decisions);
  if (!m) throw new Error(`No row for ${id} in DECISIONS.md`);
  return m[0];
};
const pct = (bp: number): string => `${String(bp / 100).replace(".", ",")} %`;
const mln = (sum: number): string => `${String(sum / 1_000_000).replace(".", ",")} млн`;
const grouped = (n: number): string => n.toLocaleString("en-US").replaceAll(",", " ");

describe("DEFAULT_FEE_SETTINGS vs DECISIONS and CONCEPT", () => {
  it("R-8: scale, minimum estimates", () => {
    const r8 = row("Р-8");
    expect(r8).toContain(`${pct(D.pcLowRateBp)} до ${mln(D.pcThreshold)}`);
    expect(r8).toContain(`${pct(D.pcHighRateBp)} от ${mln(D.pcThreshold)}`);
    expect(r8).toContain(`не меньше ${mln(D.pcHighMinFee)}`);
    expect(r8).toContain(`монтаж ${pct(D.mountRateBp)}`);
    expect(r8).toContain(`полный цикл от ${mln(D.minFullCyclePc)}`);
    expect(r8).toContain(`в свободные окна от ${mln(D.minFreeWindowPc)}`);
    expect(r8).toContain(`сетап от ${mln(D.minFullCycleSetup)}`);
    expect(r8).toContain("без потолка");
  });

  it("CONCEPT 1.2: complex build rate and minimum estimates", () => {
    expect(concept).toContain(
      `Сложная сборка: кастомное жидкостное охлаждение, малый корпус (ITX), перенос в корпус клиента | ${pct(D.complexRateBp)} при любом бюджете | ${mln(D.minFullCyclePc)}`,
    );
    expect(concept).toContain(`Сетап с монтажом целиком | По строкам выше | ${mln(D.minFullCycleSetup)} сум`);
  });

  it("R-9: advance 30 % at the estimate, 70 % at handover, estimate validity 24 / 72 hours", () => {
    const r9 = row("Р-9");
    expect(r9).toContain(`${pct(D.advanceBp)} платы при смете, ${pct(10_000 - D.advanceBp)} при сдаче`);
    expect(r9).toContain("100 % лимита");
    expect(r9).toContain(`смета ${D.shelfLifeHours.components} / ${D.shelfLifeHours.furniture} часа`);
  });

  it("note on default rules: rounding down, 50/50 lines, 24 h mixed estimate, 5 % reserve, 85 % after tests", () => {
    expect(decisions).toContain("плата округляется вниз до целого сума");
    expect(decisions).toContain("50/50 по долям этапов");
    expect(D.commissionLineStages).toEqual(["selection", "purchase"]);
    expect(D.stageSharesBp.selection + D.stageSharesBp.purchase).toBe(5000);
    expect(decisions).toContain(`смешанная смета действует ${D.shelfLifeHours.components} часа`);
    expect(decisions).toContain(
      `резерв на рост цен — ${pct(D.reserveHighBp)} вместо ${pct(D.reserveBp)}, если память и SSD составляют ${pct(D.reserveHighShareBp)} сметы и больше`,
    );
    expect(decisions).toContain(`при отказе после тестов удерживается ${pct(D.afterTestsRetainBp)} платы`);
  });

  it("R-9: reserve for price growth 3 % and 5 %, rounded up to 10 000 (ARCHITECTURE 4.6)", () => {
    expect(row("Р-9") + decisions).toContain(`Резерв на колебание цен: ${pct(D.reserveBp)}`);
    expect(architecture).toContain(`округление вверх до ${grouped(D.reserveRoundStep)} сум`);
  });

  it("R-26: Podbor 20 % of the fee, credited within 30 days", () => {
    expect(row("Р-26")).toContain(`${pct(D.podborShareBp)} платы с зачётом ${D.podborCreditDays} дней`);
  });

  it("CONCEPT 2.5: stage shares of the price list", () => {
    const s = D.stageSharesBp;
    expect(concept).toContain(
      `подбор и смета — ${pct(s.selection)}; закупка, отчёт, ручательство — ${pct(s.purchase)}; сборка, ОС, тесты — ${pct(s.assembly)}; доставка, установка, сдача — ${pct(s.handover)}`,
    );
    expect(s.selection + s.purchase + s.assembly + s.handover).toBe(10_000);
  });

  it("is a published price list with a version and a date", () => {
    expect(D.version).toBe("2026-10-05");
    expect(D.effectiveFrom).toBe("2026-10-05");
    expect(decisions).toContain("05.10.2026");
  });

  it("is frozen: a caller cannot change the defaults for everyone", () => {
    expect(Object.isFrozen(D)).toBe(true);
    expect(Object.isFrozen(D.stageSharesBp)).toBe(true);
    expect(Object.isFrozen(D.commissionLineStages)).toBe(true);
    expect(() => {
      (D as { pcLowRateBp: number }).pcLowRateBp = 1;
    }).toThrow(TypeError);
  });
});

describe("reserve and threshold defaults vs documents", () => {
  it("R-12 and CONCEPT 2.6: warranty reserve", () => {
    const w = WARRANTY_RESERVE;
    expect(row("Р-12")).toContain(
      `резерв ${pct(w.rateBp)}, не меньше ${grouped(w.minSum)} сум, затем ${pct(w.matureRateBp)}`,
    );
    expect(concept).toContain(
      `${pct(w.rateBp)} стоимости комплектующих с заказа, не меньше ${grouped(w.minSum)} сум, пока резерв не дойдёт до ${mln(w.matureBalance)} сум и не наберётся ${w.matureOrders} закрытых заказов; затем ${pct(w.matureRateBp)}, если фактические потери за 12 месяцев ниже ${pct(w.matureMaxLossesBp)}`,
    );
  });

  it("R-7: tax-risk reserve 1 % of purchases", () => {
    expect(decisions).toContain(`Резерв налогового риска ${pct(TAX_RISK_RESERVE_BP)} от закупок`);
  });

  it("R-7: threshold 1 bn sum, alerts 60 to 100 % (ARCHITECTURE 4.8)", () => {
    expect(decisions).toContain("Порог по НК — 1 млрд сум в год");
    expect(DEFAULT_THRESHOLD_SETTINGS.annualLimit).toBe(1_000_000_000);
    expect(architecture).toContain("Оповещения — 60, 70 (бухгалтер уровня 2), 80, 90, 100 %");
    expect(DEFAULT_THRESHOLD_SETTINGS.alertsBp).toEqual([6000, 7000, 8000, 9000, 10_000]);
    expect(DEFAULT_THRESHOLD_SETTINGS.proportion).toBe("without_registration_day");
  });
});
