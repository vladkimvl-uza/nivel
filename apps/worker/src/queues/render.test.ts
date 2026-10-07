import { describe, expect, it } from "vitest";
import { composeRenderers, formatBpText, formatSumText, workerRenderer } from "./render.ts";

const r = workerRenderer;

describe("formatSumText and formatBpText: whole sums and basis points, no floating point", () => {
  it("groups the digits of a sum by thousands", () => {
    expect(formatSumText(0)).toBe("0");
    expect(formatSumText(999)).toBe("999");
    expect(formatSumText(1_000)).toBe("1 000");
    expect(formatSumText(210_958_904)).toBe("210 958 904");
    expect(formatSumText(1_000_000_000)).toBe("1 000 000 000");
  });

  it("writes basis points as percent with a decimal comma, two digits", () => {
    expect(formatBpText(6000)).toBe("60");
    expect(formatBpText(6234)).toBe("62,34");
    expect(formatBpText(6205)).toBe("62,05");
    expect(formatBpText(0)).toBe("0");
    expect(formatBpText(10_000)).toBe("100");
    expect(formatBpText(5)).toBe("0,05");
  });
});

describe("the texts of the customer (uz and ru)", () => {
  it("reminds about the prepayment and the money for the purchases a day after the acceptance, in the language of the customer", () => {
    const both = { number: "NV-2026-0007", missing: "both" };
    const ru = r.render("order.accept_reminder", "ru", both);
    const uz = r.render("order.accept_reminder", "uz", both);
    expect(ru).toContain("NV-2026-0007");
    expect(ru).toContain("предоплат");
    expect(ru).toContain("деньги на закупку");
    expect(uz).toContain("NV-2026-0007");
    expect(uz).toContain("oldindan toʻlov");
    expect(uz).toContain("xarid uchun mablagʻ");
  });

  it("names only what is missing", () => {
    const fee = r.render("order.accept_reminder", "ru", { number: "NV-2026-0007", missing: "fee" }) as string;
    expect(fee).toContain("предоплат");
    expect(fee).not.toContain("деньги на закупку");
    const funds = r.render("order.accept_reminder", "uz", { number: "NV-2026-0007", missing: "funds" }) as string;
    expect(funds).toContain("xarid uchun mablagʻ");
    expect(funds).not.toContain("oldindan");
  });

  it("writes Uzbek with the letters of the standard: oʻ and gʻ with U+02BB, no ASCII or typographic apostrophe", () => {
    for (const missing of ["fee", "funds", "both"]) {
      const text = r.render("order.accept_reminder", "uz", { number: "NV-2026-0007", missing }) as string;
      expect(text).not.toMatch(/['’‘`]/);
      expect(text).toMatch(/[oOgG]ʻ/);
    }
  });

  it("never names a card number or a way to pay with a personal card", () => {
    const text = r.render("order.accept_reminder", "ru", { number: "NV-2026-0007", missing: "both" }) as string;
    expect(text).not.toMatch(/\d{4} ?\d{4} ?\d{4} ?\d{4}/);
    expect(text).not.toMatch(/карт/i);
  });
});

describe("the texts of the owner (Russian: the owner reads the admin panel in Russian)", () => {
  it("tells a request without an answer", () => {
    expect(r.render("reminder.lead_no_answer", "ru", { number: "L-2026-0007", minutes: 15 })).toBe(
      "Заявка L-2026-0007 без ответа 15 мин. Ответьте клиенту в теме заявки.",
    );
  });

  it("tells a new request with what is known of it", () => {
    expect(
      r.render("lead.created", "ru", {
        number: "L-2026-0007",
        scope: "pc",
        district: "Chilonzor",
        budgetBand: "12m_20m",
      }),
    ).toBe("Новая заявка L-2026-0007: ПК, Chilonzor, бюджет 12–20 млн");
    expect(r.render("lead.created", "ru", { number: "L-2026-0008", scope: "setup" })).toBe(
      "Новая заявка L-2026-0008: сетап",
    );
  });

  it("tells a threshold level with the share, the volume and the limit in whole sums", () => {
    const text = r.render("threshold.alert", "ru", {
      year: 2026,
      levelBp: 6000,
      shareBp: 6234,
      volume: 623_400_000,
      limit: 1_000_000_000,
    }) as string;
    expect(text).toContain("60 %");
    expect(text).toContain("62,34 %");
    expect(text).toContain("623 400 000");
    expect(text).toContain("1 000 000 000");
    expect(text).toContain("2026");
  });

  it("adds the call for the accountant at 70 % and says the limit is reached at 100 %", () => {
    const at = (levelBp: number) =>
      r.render("threshold.alert", "ru", { year: 2026, levelBp, shareBp: levelBp, volume: 1, limit: 2 }) as string;
    expect(at(7000)).toContain("бухгалтер");
    expect(at(6000)).not.toContain("бухгалтер");
    expect(at(10_000)).toContain("достигнут");
  });

  it("tells that the forecast is over the plan", () => {
    const text = r.render("threshold.plan", "ru", {
      year: 2026,
      planCap: 200_000_000,
      projectedShareBp: 2500,
    }) as string;
    expect(text).toContain("план");
    expect(text).toContain("200 000 000");
  });

  it("tells a failed job with its queue, the attempts and the cleaned message", () => {
    const text = r.render("ops.job_failed", "ru", {
      queue: "ledger.append",
      attempts: 5,
      count: 3,
      message: "db down",
    }) as string;
    expect(text).toContain("ledger.append");
    expect(text).toContain("5");
    expect(text).toContain("db down");
  });

  it("tells a failed selfcheck", () => {
    const text = r.render("ops.alert", "ru", { check: "backup_age", detail: "30 ч" }) as string;
    expect(text).toContain("копи");
    expect(text).toContain("30 ч");
  });

  it("tells reminders of the order for the owner", () => {
    expect(r.render("reminder.report_due", "ru", { number: "NV-2026-0007", last: false })).toContain("отчёт");
    expect(r.render("reminder.report_due", "ru", { number: "NV-2026-0007", last: true })).toContain("крайний");
    expect(r.render("reminder.refund_due", "ru", { number: "NV-2026-0007" })).toContain("возврат");
    expect(r.render("reminder.aftercare", "ru", { number: "NV-2026-0007", days: 7 })).toContain("7");
  });

  it("tells the overdue terms of a warranty case, the end of the warranty of a shop, the ESF, the maintenance", () => {
    expect(r.render("reminder.warranty_sla", "ru", { caseNumber: "G-2026-0003", kind: "reply" })).toBe(
      "Гарантийный случай G-2026-0003: срок ответа клиенту прошёл (1 рабочий день).",
    );
    expect(r.render("reminder.warranty_sla", "ru", { caseNumber: "G-2026-0003", kind: "diagnosis" })).toContain(
      "диагностики",
    );
    expect(r.render("reminder.warranty_sla", "ru", { caseNumber: "G-2026-0003", kind: "fix" })).toContain("устранения");
    expect(r.render("reminder.vendor_warranty", "ru", { number: "NV-2026-0007", until: "2026-11-11", items: 2 })).toBe(
      "Заказ NV-2026-0007: гарантия магазина на 2 поз. заканчивается 11.11.2026. Если есть проблемы с этими позициями, обращайтесь в магазин до этой даты.",
    );
    expect(r.render("reminder.esf_due", "ru", { number: "NV-2026-0007", dueDate: "2026-10-22" })).toContain("ЭСФ");
    expect(r.render("reminder.maintenance", "ru", { number: "NV-2026-0007", months: 6 })).toContain("профилактик");
  });

  it("builds the digest of the errors of the day", () => {
    const text = r.render("ops.digest", "ru", {
      items: [
        { queue: "ledger.append", message: "db down", count: 3 },
        { queue: "web.revalidate", message: "HTTP 502", count: 1 },
      ],
    }) as string;
    expect(text).toContain("ledger.append");
    expect(text).toContain("×3");
    expect(text).toContain("web.revalidate");
  });

  it("says how many failures the digest does not list", () => {
    const text = r.render("ops.digest", "ru", { items: [{ queue: "q", message: "m", count: 1 }], more: 4 }) as string;
    expect(text).toContain("и ещё 4");
  });
});

describe("the renderer", () => {
  it("does not know the templates of the order automaton (they come with the bot) and says so with null", () => {
    expect(r.render("order.estimate_sent", "uz", {})).toBeNull();
    expect(r.render("nothing", "ru", {})).toBeNull();
  });

  it("falls back to the next renderer of a composition when one does not know the key", () => {
    const other = { render: (key: string) => (key === "order.estimate_sent" ? "smeta" : null) };
    const both = composeRenderers([other, workerRenderer]);
    expect(both.render("order.estimate_sent", "uz", {})).toBe("smeta");
    expect(both.render("ops.alert", "ru", { check: "disk", detail: "85 %" })).toContain("85 %");
    expect(both.render("missing", "ru", {})).toBeNull();
  });

  it("does not trust params of the wrong kind: a number is not printed from a string with markup", () => {
    const text = r.render("lead.created", "ru", { number: 42, scope: { evil: true } }) as string;
    expect(text).not.toContain("[object Object]");
  });
});
