import { describe, expect, it } from "vitest";
import { BUILTIN_PD_CONSENT_VERSION, parseLeadForm } from "./form.ts";

const valid = {
  name: "Aziz Karimov",
  phone: "+998 90 123 45 67",
  telegram: "",
  scope: "pc",
  district: "Yunusobod",
  budget: "27,5",
  comment: "Oʻyin uchun kompyuter",
  consent: "on",
  website: "",
  locale: "uz",
};

function form(o: Record<string, string | undefined>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) if (v !== undefined) f.set(k, v);
  return f;
}

describe("parseLeadForm", () => {
  it("builds the command for the services from a good form", () => {
    const r = parseLeadForm(form(valid));
    expect(r).toMatchObject({ kind: "ok" });
    if (r.kind !== "ok") return;
    expect(r.command).toEqual({
      channel: "web",
      scope: "pc",
      lang: "uz",
      district: "Yunusobod",
      budgetSum: 27_500_000,
      comment: "Oʻyin uchun kompyuter",
      customer: { displayName: "Aziz Karimov", phoneE164: "+998901234567" },
      consent: { kind: "pd_processing", granted: true, textVersion: BUILTIN_PD_CONSENT_VERSION },
    });
  });

  it("accepts a plain object as well as FormData", () => {
    expect(parseLeadForm(valid).kind).toBe("ok");
  });

  it("needs only a contact, a task and the consent", () => {
    const r = parseLeadForm(form({ phone: "901234567", scope: "setup", consent: "on", locale: "ru" }));
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.command).toEqual({
      channel: "web",
      scope: "setup",
      lang: "ru",
      customer: { phoneE164: "+998901234567" },
      consent: { kind: "pd_processing", granted: true, textVersion: BUILTIN_PD_CONSENT_VERSION },
    });
  });

  it("takes a Telegram nickname instead of a phone, with or without @ and link", () => {
    for (const raw of ["@nivel_user", "nivel_user", "https://t.me/nivel_user", "t.me/nivel_user", " @nivel_user "]) {
      const r = parseLeadForm(form({ ...valid, phone: "", telegram: raw }));
      expect(r.kind).toBe("ok");
      if (r.kind === "ok") {
        expect(r.command.customer).toEqual({ displayName: "Aziz Karimov", telegramUsername: "nivel_user" });
      }
    }
  });

  it("keeps both contacts when both are given", () => {
    const r = parseLeadForm(form({ ...valid, telegram: "@nivel_user" }));
    expect(r.kind === "ok" && r.command.customer).toEqual({
      displayName: "Aziz Karimov",
      phoneE164: "+998901234567",
      telegramUsername: "nivel_user",
    });
  });

  it("asks for a contact when there is none", () => {
    const r = parseLeadForm(form({ ...valid, phone: "", telegram: "" }));
    expect(r).toMatchObject({ kind: "invalid", fields: { phone: "contact_required" } });
  });

  it("names the bad phone and the bad nickname", () => {
    expect(parseLeadForm(form({ ...valid, phone: "12345" }))).toMatchObject({
      kind: "invalid",
      fields: { phone: "phone_invalid" },
    });
    expect(parseLeadForm(form({ ...valid, phone: "", telegram: "a b" }))).toMatchObject({
      kind: "invalid",
      fields: { telegram: "telegram_invalid" },
    });
    expect(parseLeadForm(form({ ...valid, phone: "", telegram: "ab" }))).toMatchObject({
      fields: { telegram: "telegram_invalid" },
    });
  });

  it("will not go on without the consent to the processing of personal data", () => {
    for (const consent of [undefined, "", "off", "no", "false"]) {
      expect(parseLeadForm(form({ ...valid, consent }))).toMatchObject({
        kind: "invalid",
        fields: { consent: "consent_required" },
      });
    }
    for (const consent of ["on", "true", "1"]) expect(parseLeadForm(form({ ...valid, consent })).kind).toBe("ok");
  });

  it("refuses a task the form does not offer", () => {
    for (const scope of ["", "podbor", "drop", undefined]) {
      expect(parseLeadForm(form({ ...valid, scope }))).toMatchObject({
        kind: "invalid",
        fields: { scope: "scope_invalid" },
      });
    }
    for (const scope of ["pc", "pc_periph", "setup"]) expect(parseLeadForm(form({ ...valid, scope })).kind).toBe("ok");
  });

  it("refuses a bad budget and takes an empty one", () => {
    expect(parseLeadForm(form({ ...valid, budget: "lots" }))).toMatchObject({ fields: { budget: "budget_invalid" } });
    expect(parseLeadForm(form({ ...valid, budget: "" }))).toMatchObject({ kind: "ok" });
  });

  it("limits the length of free text", () => {
    expect(parseLeadForm(form({ ...valid, name: "a".repeat(121) }))).toMatchObject({ fields: { name: "too_long" } });
    expect(parseLeadForm(form({ ...valid, district: "a".repeat(81) }))).toMatchObject({
      fields: { district: "too_long" },
    });
    expect(parseLeadForm(form({ ...valid, comment: "a".repeat(2001) }))).toMatchObject({
      fields: { comment: "too_long" },
    });
    expect(parseLeadForm(form({ ...valid, comment: "a".repeat(2000) })).kind).toBe("ok");
  });

  it("refuses control characters in free text (a NUL would break the insert and slip past the limit)", () => {
    for (const field of ["name", "district", "comment", "telegram"] as const) {
      for (const bad of ["a\u0000b", "a\u0007b", "a\u001fb", "a\u007fb"]) {
        const over = field === "telegram" ? { phone: "", telegram: `nick${bad}` } : { [field]: bad };
        const r = parseLeadForm(form({ ...valid, ...over }));
        expect(r.kind, `${field} ${JSON.stringify(bad)}`).toBe("invalid");
      }
    }
    expect(parseLeadForm(form({ ...valid, name: "a\u0000b" }))).toMatchObject({ fields: { name: "rejected" } });
  });

  it("lets a comment keep its line breaks and tabs", () => {
    const r = parseLeadForm(form({ ...valid, comment: "one\r\ntwo\n\tthree" }));
    expect(r).toMatchObject({ kind: "ok", command: { comment: "one\r\ntwo\n\tthree" } });
  });

  it("drops a campaign mark with control characters", () => {
    const r = parseLeadForm(form({ ...valid, utm_source: "ads\u0000", utm_medium: "cpc" }));
    expect(r).toMatchObject({ kind: "ok", command: { utm: { utm_medium: "cpc" } } });
  });

  it("gives the ticked consent back with the typed text, so that an error does not take the tick away", () => {
    const r = parseLeadForm(form({ ...valid, phone: "1", consent: "on" }));
    expect(r.kind).toBe("invalid");
    if (r.kind !== "invalid") return;
    expect(r.values.consent).toBe("on");
    const none = parseLeadForm(form({ ...valid, phone: "1", consent: "" }));
    if (none.kind !== "invalid") throw new Error("invalid expected");
    expect(none.values.consent).toBeUndefined();
  });

  it("reports every problem at once and gives the typed text back", () => {
    const r = parseLeadForm(form({ ...valid, phone: "1", consent: "", scope: "x", name: "N" }));
    expect(r.kind).toBe("invalid");
    if (r.kind !== "invalid") return;
    expect(Object.keys(r.fields).sort()).toEqual(["consent", "phone", "scope"]);
    expect(r.values).toMatchObject({ name: "N", phone: "1", scope: "x", district: "Yunusobod" });
  });

  it("recognizes the trap for bots by the hidden field", () => {
    expect(parseLeadForm(form({ ...valid, website: "http://spam.example" }))).toEqual({ kind: "honeypot" });
    // blanks alone are what a browser may leave behind, not what a bot writes
    expect(parseLeadForm(form({ ...valid, website: " " })).kind).toBe("ok");
  });

  it("falls back to Uzbek for an unknown language", () => {
    for (const locale of ["de", "", undefined, "RU"]) {
      const r = parseLeadForm(form({ ...valid, locale }));
      expect(r.kind === "ok" && r.command.lang).toBe("uz");
    }
  });

  it("trims text and drops empty optional fields from the command", () => {
    const r = parseLeadForm(form({ ...valid, name: "  Aziz  ", district: "   ", comment: "", budget: " " }));
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.command.customer.displayName).toBe("Aziz");
    expect("district" in r.command).toBe(false);
    expect("comment" in r.command).toBe(false);
    expect("budgetSum" in r.command).toBe(false);
  });

  it("takes known campaign marks and nothing else", () => {
    const r = parseLeadForm(
      form({
        ...valid,
        utm_source: "instagram",
        utm_medium: "story",
        utm_campaign: "c".repeat(300),
        utm_evil: "x",
        other: "y",
      }),
    );
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.command.utm).toEqual({ utm_source: "instagram", utm_medium: "story" });
  });

  it("does not take a file for text", () => {
    const f = form(valid);
    f.set("name", new File(["x"], "x.txt"));
    const r = parseLeadForm(f);
    expect(r.kind).toBe("ok");
    expect(r.kind === "ok" && r.command.customer.displayName).toBeUndefined();
  });
});
