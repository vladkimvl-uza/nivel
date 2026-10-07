import { describe, expect, it } from "vitest";
import { pdfText } from "./messages.ts";
import {
  assertNoCardNumber,
  assertNoCardNumberDeep,
  CardNumberError,
  looksLikeCard,
  paymentPurpose,
  requisiteRows,
} from "./requisites.ts";

const IP = {
  holder: "YaTT Karimov Aziz Bakhtiyorovich",
  inn: "123456789",
  bank: "Bank «Nivel-test»",
  account: "2020 8000 1234 5678 9012",
  mfo: "00014",
  purpose: "Средства комитента по заказу {number}",
} as const;

describe("a card number never reaches a document (CLAUDE.md, red lines of the money)", () => {
  it("knows sixteen digits alone or in groups of four", () => {
    for (const card of [
      "8600123412341234",
      "8600 1234 1234 1234",
      "8600-1234-1234-1234",
      "карта 8600 1234 1234 1234 .",
    ]) {
      expect(looksLikeCard(card), card).toBe(true);
    }
  });

  it("knows a card written with the spaces the project itself prints (no-break, narrow, thin), dots, slashes, double spaces and line breaks", () => {
    const groups = ["8600", "1234", "1234", "1234"];
    for (const sep of ["\u00A0", "\u202F", "\u2009", "\u2007", "  ", "\n", ".", "/", "\u2011", "\u2013", " - "]) {
      expect(looksLikeCard(groups.join(sep)), JSON.stringify(sep)).toBe(true);
    }
    expect(looksLikeCard("8600 12 34 1234 1234")).toBe(true);
    expect(looksLikeCard("номер: 8600\n1234\n1234\n1234.")).toBe(true);
  });

  it("knows a card that is followed by its term (five groups of four are a card and its date, not an account)", () => {
    expect(looksLikeCard("8600123412341234 0927")).toBe(true);
    expect(looksLikeCard("8600 1234 1234 1234 09/27")).toBe(true);
    expect(looksLikeCard("20208000123456789012")).toBe(true);
    expect(looksLikeCard("2020 8000 1234 5678 9012")).toBe(true);
  });

  it("knows a card of nineteen digits and does not take a long run of other digits for one", () => {
    expect(looksLikeCard("6200 1234 1234 1234 123")).toBe(true);
    expect(looksLikeCard("1234567890 12.10.2026 4150000")).toBe(false);
    expect(looksLikeCard("Чек 0004457812 от 12.10.2026, 14:30")).toBe(false);
    expect(looksLikeCard("гарантия 12.10.2026 - 12.10.2027")).toBe(false);
    expect(looksLikeCard("12.10.2026 \u2013 14.10.2026")).toBe(false);
  });

  it("does not take the INN, the MFO, a number of an order or a date for a card", () => {
    for (const ok of ["123456789", "00014", "NV-2026-0001", "1250000", "12.10.2026 4 150 000", "+998 90 123 45 67"]) {
      expect(looksLikeCard(ok), ok).toBe(false);
    }
  });

  it("takes the twenty digits of the account of a company for an account only in the field of the account", () => {
    for (const ok of [
      "20208000123456789012",
      "2020 8000 1234 5678 9012",
      "2020\u00A08000\u00A01234\u00A05678\u00A09012",
    ]) {
      expect(looksLikeCard(ok, { account: true }), ok).toBe(false);
    }
    expect(looksLikeCard("8600 1234 1234 1234", { account: true })).toBe(true);
    expect(looksLikeCard("8600123412341234 0927", { account: true })).toBe(true);
    expect(looksLikeCard("карта 8600 1234 1234 1234 и счёт 20208000123456789012", { account: true })).toBe(true);
  });

  it("refuses a card in any of the requisites, naming the field", () => {
    expect(() => assertNoCardNumber("requisites.account", "8600 1234 1234 1234")).toThrow(CardNumberError);
    expect(() => assertNoCardNumber("requisites.purpose", "Перевод на карту 8600123412341234")).toThrow(
      /requisites\.purpose/,
    );
    expect(() => assertNoCardNumber("x", null, undefined, "")).not.toThrow();
  });

  it("looks into nested data but leaves the numbers of receipts and serials alone", () => {
    const doc = {
      lines: [{ title: "Видеокарта", receiptNo: "1234567890123456", serials: ["1111222233334444"] }],
      note: "ok",
    };
    expect(() => assertNoCardNumberDeep(doc)).not.toThrow();
    expect(() => assertNoCardNumberDeep({ lines: [{ title: "Оплатите на 8600 1234 1234 1234" }] })).toThrow(
      CardNumberError,
    );
    expect(() => assertNoCardNumberDeep({ a: { b: ["x", { c: "8600123412341234" }] } })).toThrow(/a\.b\.1\.c/);
  });
});

describe("the requisites of the sole proprietor", () => {
  const uz = pdfText("uz");
  const ru = pdfText("ru");

  it("lists the holder, INN, bank, account and MFO of the account of the IP and nothing else", () => {
    const rows = requisiteRows(IP, ru);
    expect(rows.map((r) => r.label)).toEqual([
      ru("requisites.holder"),
      ru("requisites.inn"),
      ru("requisites.bank"),
      ru("requisites.account"),
      ru("requisites.mfo"),
    ]);
    expect(rows.map((r) => r.value)).toEqual([IP.holder, IP.inn, IP.bank, IP.account, IP.mfo]);
    expect(rows.every((r) => !r.pending)).toBe(true);
  });

  it("prints «roʻyxatdan oʻtgach» in Uzbek and «после регистрации» in Russian while the IP is not registered", () => {
    const empty = requisiteRows(null, uz);
    expect(empty).toHaveLength(5);
    expect(empty.every((r) => r.pending && r.value === "roʻyxatdan oʻtgach")).toBe(true);
    expect(
      requisiteRows({ holder: "  ", inn: null }, ru).every((r) => r.pending && r.value === "после регистрации"),
    ).toBe(true);
    expect(requisiteRows(undefined, ru)[0]?.value).toBe("после регистрации");
  });

  it("fills only the fields that are there and keeps a placeholder for the rest", () => {
    const rows = requisiteRows({ holder: "YaTT Karimov", account: "20208000123456789012" }, uz);
    expect(rows.map((r) => r.pending)).toEqual([false, true, true, false, true]);
  });

  it("refuses a card with odd spaces or with its term in any of the requisites and in the text of a document", () => {
    expect(() => requisiteRows({ ...IP, holder: "8600\u00A01234\u00A01234\u00A01234" }, uz)).toThrow(CardNumberError);
    expect(() => requisiteRows({ ...IP, account: "8600123412341234 0927" }, uz)).toThrow(CardNumberError);
    expect(() => paymentPurpose({ purpose: "на 8600\u202F1234\u202F1234\u202F1234" }, "NV-1", ru)).toThrow(
      CardNumberError,
    );
    expect(() => assertNoCardNumberDeep({ notes: "8600.1234.1234.1234" })).toThrow(CardNumberError);
    expect(() => assertNoCardNumberDeep({ notes: "карта\n8600 1234 1234 1234 0927" })).toThrow(CardNumberError);
    expect(() => assertNoCardNumberDeep({ ip: { account: "20208000123456789012" } })).not.toThrow();
  });

  it("refuses requisites that hold a card number", () => {
    expect(() => requisiteRows({ ...IP, account: "8600 1234 1234 1234" }, uz)).toThrow(CardNumberError);
    expect(() => requisiteRows({ ...IP, holder: "карта 8600123412341234" }, uz)).toThrow(CardNumberError);
  });

  it("writes the purpose of the payment: the owner's words with the number of the order, or the standard one without VAT", () => {
    expect(paymentPurpose(IP, "NV-2026-0001", ru)).toBe("Средства комитента по заказу NV-2026-0001");
    expect(paymentPurpose({ ...IP, purpose: null }, "NV-2026-0001", ru)).toBe(
      "Средства комитента на закупку по договору № NV-2026-0001. Без НДС",
    );
    expect(paymentPurpose(null, "NV-2026-0001", uz)).toContain("NV-2026-0001");
    expect(paymentPurpose(null, "NV-2026-0001", uz)).toMatch(/QQSsiz\.?$/);
  });

  it("refuses a purpose with a card number and replaces every {number}", () => {
    expect(() => paymentPurpose({ purpose: "на карту 8600 1234 1234 1234" }, "NV-2026-0001", ru)).toThrow(
      CardNumberError,
    );
    expect(paymentPurpose({ purpose: "{number} / {number}" }, "NV-2026-0002", ru)).toBe("NV-2026-0002 / NV-2026-0002");
  });
});
