import { describe, expect, it } from "vitest";
import { botTranslator } from "./messages.ts";
import {
  keyboardMarkup,
  OUTBOX_TEMPLATE_KEYS,
  type OutboxTelegramPayload,
  renderOutboxMessage,
  UnknownTemplateError,
} from "./templates.ts";

const ACT_ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const LEAD_ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";
const CARD = /(?<![0-9])[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}(?![0-9])/;

/** The payloads the services write (outbox contract): the order automaton names the key, the lead has its own. */
function payloadFor(key: string, lang: "uz" | "ru"): OutboxTelegramPayload {
  const base = {
    target: "customer",
    templateKey: key,
    lang,
    orderNumber: "NV-2026-0001",
    telegramUserId: 7_100_000_001,
  };
  switch (key) {
    case "lead.created":
      return {
        target: "owner_topic",
        templateKey: key,
        leadId: LEAD_ID,
        params: { number: "L-2026-0007", scope: "pc", district: "Chilonzor", budgetBand: "12m_20m" },
      };
    case "order.report_objection":
    case "accountant.income_adjustment":
      return { ...base, target: "owner_topic" };
    case "quote.price_uncertain":
      return {
        target: "customer",
        templateKey: key,
        lang,
        params: { productId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5d" },
      };
    case "quote.demo_data":
      return { target: "customer", templateKey: key, lang };
    case "act.sign_request":
      return { ...base, params: { actId: ACT_ID, actKind: "handover" } };
    default:
      return base;
  }
}

describe("the list of messages the relay sends", () => {
  it("names every key of the task list of WP-07 plus the act with its button", () => {
    expect([...OUTBOX_TEMPLATE_KEYS].sort()).toEqual(
      [
        "lead.created",
        "order.estimate_sent",
        "order.estimate_expired",
        "order.accepted",
        "order.purchase_recorded",
        "order.report_sent",
        "order.report_objection",
        "order.assembly_photos",
        "order.ready",
        "order.delivering",
        "order.handed_over",
        "order.podbor_delivered",
        "order.cancelling",
        "order.cancelled",
        "accountant.income_adjustment",
        "quote.price_uncertain",
        "quote.demo_data",
        "act.sign_request",
      ].sort(),
    );
  });

  it.each(OUTBOX_TEMPLATE_KEYS.flatMap((k) => (["uz", "ru"] as const).map((l) => [k, l] as const)))(
    "%s renders in %s: real text, no raw key, fits a message, no card number, buttons within 64 bytes",
    (key, lang) => {
      const m = renderOutboxMessage(payloadFor(key, lang));
      expect(m.text.trim().length).toBeGreaterThan(5);
      expect(m.text.length).toBeLessThanOrEqual(4096);
      expect(m.text).not.toContain(key);
      expect(m.text).not.toMatch(/\{|\}|undefined|NaN/);
      expect(m.text).not.toMatch(CARD);
      for (const row of m.buttons) {
        for (const b of row) {
          expect(Buffer.byteLength(b.callbackData, "utf8")).toBeLessThanOrEqual(64);
          expect(b.text.length).toBeGreaterThan(0);
          expect(b.text.length).toBeLessThanOrEqual(64);
        }
      }
    },
  );
});

describe("language", () => {
  it("a customer message follows the language of the payload", () => {
    const uz = renderOutboxMessage(payloadFor("order.ready", "uz"));
    const ru = renderOutboxMessage(payloadFor("order.ready", "ru"));
    expect(uz.lang).toBe("uz");
    expect(ru.lang).toBe("ru");
    expect(uz.text).toContain("NV-2026-0001");
    expect(uz.text).toMatch(/yigʻildi/);
    expect(ru.text).toMatch(/собран/);
  });

  it("the owner's topic is in Russian whatever the language of the customer", () => {
    const m = renderOutboxMessage({ ...payloadFor("order.report_objection", "uz"), lang: "uz" });
    expect(m.lang).toBe("ru");
    expect(m.text).toMatch(/Клиент/);
  });

  it("falls back to Uzbek, the first language, when the payload has none", () => {
    const { lang: _lang, ...noLang } = payloadFor("order.cancelled", "ru");
    expect(renderOutboxMessage(noLang).lang).toBe("uz");
    expect(renderOutboxMessage({ ...noLang, lang: "en" as never }).lang).toBe("uz");
  });
});

describe("buttons", () => {
  it("the report carries the two buttons of the customer: confirm and ask", () => {
    const m = renderOutboxMessage(payloadFor("order.report_sent", "uz"));
    expect(m.buttons.flat().map((b) => b.callbackData)).toEqual(["o:NV-2026-0001:rok", "o:NV-2026-0001:obj"]);
    expect(m.buttons.flat().map((b) => b.text)).toEqual(["Tasdiqlayman", "Savol bor"]);
  });

  it("the estimate opens the card of the order", () => {
    const m = renderOutboxMessage(payloadFor("order.estimate_sent", "ru"));
    expect(m.buttons.flat().map((b) => b.callbackData)).toEqual(["o:NV-2026-0001:view"]);
  });

  it("a handed over order offers to report a problem", () => {
    const m = renderOutboxMessage(payloadFor("order.handed_over", "ru"));
    expect(m.buttons.flat().map((b) => b.callbackData)).toContain("o:NV-2026-0001:warr");
  });

  it("the act has one button that carries the id of the act", () => {
    const m = renderOutboxMessage(payloadFor("act.sign_request", "ru"));
    expect(m.buttons.flat()).toEqual([{ text: "Принял", callbackData: "a:0190a1b2c3d47e5f8a9b0c1d2e3f4a5b:sg" }]);
    expect(m.text).toContain("NV-2026-0001");
    expect(m.text).toMatch(/сдачи/);
  });

  it("the card of a lead has the three buttons of the owner with the id of the lead", () => {
    const m = renderOutboxMessage(payloadFor("lead.created", "ru"));
    expect(m.buttons.flat().map((b) => b.callbackData)).toEqual([
      "l:0190a1b2c3d47e5f8a9b0c1d2e3f4a5c:wk",
      "l:0190a1b2c3d47e5f8a9b0c1d2e3f4a5c:ad",
      "l:0190a1b2c3d47e5f8a9b0c1d2e3f4a5c:sp",
    ]);
  });

  it("the objection opens the card for the owner", () => {
    const m = renderOutboxMessage(payloadFor("order.report_objection", "ru"));
    expect(m.buttons.flat().map((b) => b.callbackData)).toEqual(["o:NV-2026-0001:card"]);
  });

  it("warnings and plain notices have no buttons", () => {
    for (const key of ["quote.price_uncertain", "quote.demo_data", "order.cancelled", "order.delivering"]) {
      expect(renderOutboxMessage(payloadFor(key, "uz")).buttons).toEqual([]);
    }
  });

  it("turns buttons into the reply_markup of the Bot API", () => {
    const m = renderOutboxMessage(payloadFor("order.report_sent", "ru"));
    expect(keyboardMarkup(m.buttons)).toEqual({
      inline_keyboard: [
        [
          { text: "Подтверждаю", callback_data: "o:NV-2026-0001:rok" },
          { text: "Есть вопрос", callback_data: "o:NV-2026-0001:obj" },
        ],
      ],
    });
    expect(keyboardMarkup([])).toBeUndefined();
  });
});

describe("parameters", () => {
  it("the lead card shows the scope, the district and the band as words", () => {
    const m = renderOutboxMessage(payloadFor("lead.created", "ru"));
    expect(m.text).toContain("L-2026-0007");
    expect(m.text).toContain("Только компьютер");
    expect(m.text).toContain("Chilonzor");
    expect(m.text).toContain("12–20 млн сум");
  });

  it("a lead without a district or a budget shows a dash, not a hole", () => {
    const m = renderOutboxMessage({
      target: "owner_topic",
      templateKey: "lead.created",
      leadId: LEAD_ID,
      params: { number: "L-2026-0008", scope: "setup" },
    });
    expect(m.text).toBe("Новая заявка L-2026-0008\nСетап (рабочее место) · район: — · бюджет: —");
  });

  it("takes the number of the order from params when the payload has none", () => {
    const m = renderOutboxMessage({
      target: "customer",
      templateKey: "order.ready",
      lang: "ru",
      params: { number: "NV-2026-0042" },
    });
    expect(m.text).toContain("NV-2026-0042");
  });

  it("refuses a message that needs a number and has none", () => {
    expect(() => renderOutboxMessage({ target: "customer", templateKey: "order.ready", lang: "ru" })).toThrow(/number/);
  });

  it("refuses a button that needs the id of the act or of the lead and has none", () => {
    expect(() =>
      renderOutboxMessage({
        target: "customer",
        templateKey: "act.sign_request",
        lang: "ru",
        orderNumber: "NV-2026-0001",
      }),
    ).toThrow(/actId/);
    expect(() =>
      renderOutboxMessage({
        target: "owner_topic",
        templateKey: "lead.created",
        params: { number: "L-2026-0001", scope: "pc" },
      }),
    ).toThrow(/leadId/);
  });

  it("refuses an order number that is not one (it ends in callback_data)", () => {
    expect(() =>
      renderOutboxMessage({ target: "customer", templateKey: "order.ready", lang: "ru", orderNumber: "NV 2026/1" }),
    ).toThrow(/number/);
  });

  it("an unknown scope or band is shown as it came, not as a raw key", () => {
    const m = renderOutboxMessage({
      target: "owner_topic",
      templateKey: "lead.created",
      leadId: LEAD_ID,
      params: { number: "L-2026-0009", scope: "mystery", budgetBand: "huge" },
    });
    expect(m.text).toContain("mystery");
    expect(m.text).toContain("huge");
  });
});

describe("unknown keys", () => {
  it("throws an error the relay can recognise, and never prints the key to a customer", () => {
    expect(() => renderOutboxMessage({ target: "customer", templateKey: "order.nonsense", lang: "uz" })).toThrow(
      UnknownTemplateError,
    );
    expect(() => renderOutboxMessage({ target: "customer", templateKey: "constructor", lang: "uz" })).toThrow(
      UnknownTemplateError,
    );
    expect(() => renderOutboxMessage({ target: "customer", templateKey: "__proto__", lang: "uz" })).toThrow(
      UnknownTemplateError,
    );
  });
});

describe("botTranslator", () => {
  it("reads the bot namespace in both languages and is cached", () => {
    expect(botTranslator("uz")("menu.select")).toBe("Kompyuter tanlash");
    expect(botTranslator("ru")("menu.select")).toBe("Подобрать компьютер");
    expect(botTranslator("uz")).toBe(botTranslator("uz"));
  });

  it("a missing key throws: a raw key must never reach a customer", () => {
    expect(() => botTranslator("ru")("menu.nothing")).toThrow();
  });
});
