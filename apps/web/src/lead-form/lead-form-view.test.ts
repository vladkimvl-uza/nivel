import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LeadForm, type LeadFormLabels, LeadFormView, type LeadFormViewProps } from "./LeadForm.tsx";
import type { LeadActionState } from "./types.ts";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const labels: LeadFormLabels = {
  name: "Name",
  phone: "Phone",
  phoneHint: "phone-hint",
  telegram: "Telegram",
  telegramHint: "tg-hint",
  scope: "Scope",
  scopePlaceholder: "Choose",
  scopes: { pc: "A PC", pc_periph: "A PC and desk", setup: "A setup" },
  district: "District",
  budget: "Budget",
  budgetHint: "budget-hint",
  comment: "Comment",
  commentHint: "comment-hint",
  website: "Leave empty",
  consent: "I agree",
  submit: "Send",
  sending: "Sending",
  okTitle: "Request {number} taken",
  okTitleNoNumber: "Request taken",
  okText: "We will write.",
  or: "or",
  telegramButton: "Write in Telegram",
  errors: { invalid: "Check the form", rate_limited: "Too often", unavailable: "Not available", failed: "Failed" },
  fieldErrors: {
    required: "Required",
    phone_invalid: "Bad phone",
    contact_required: "Give a contact",
    telegram_invalid: "Bad nickname",
    too_long: "Too long",
    budget_invalid: "Bad budget",
    scope_invalid: "Bad scope",
    consent_required: "Consent first",
    rejected: "Rejected",
  },
};

const view = (state: LeadActionState, over: Partial<LeadFormViewProps> = {}) =>
  renderToStaticMarkup(
    createElement(LeadFormView, {
      labels,
      locale: "uz",
      utm: {},
      consentNote: "note",
      botUrl: "https://t.me/example_bot",
      state,
      action: () => {},
      pending: false,
      ...over,
    }),
  );

describe("LeadFormView", () => {
  it("renders the empty form: every field, the consent unticked, no error", () => {
    const html = view({ status: "idle" });
    for (const w of ["Name", "Phone", "Telegram", "Scope", "District", "Budget", "Comment", "I agree", "Send"]) {
      expect(html).toContain(w);
    }
    expect(html).toContain("noValidate");
    expect(html).not.toContain('role="alert"');
    expect(html).toContain('<input type="hidden" name="locale" value="uz"/>');
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*name="consent"/);
  });

  it("keeps the consent ticked after an answer of the server that did not refuse it", () => {
    const html = view({
      status: "error",
      code: "invalid",
      fields: { phone: "phone_invalid" },
      values: { phone: "12345", consent: "on" },
    });
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*name="consent"[^>]*checked/);
    const refused = view({
      status: "error",
      code: "invalid",
      fields: { consent: "consent_required" },
      values: { phone: "+998901234567" },
    });
    expect(refused).not.toMatch(/<input[^>]*name="consent"[^>]*checked/);
    expect(view({ status: "idle" })).not.toMatch(/<input[^>]*name="consent"[^>]*checked/);
  });

  it("hides the trap for bots from screen readers and the keyboard", () => {
    const html = view({ status: "idle" });
    expect(html).toMatch(/<div class="hp" aria-hidden="true">/);
    expect(html).toMatch(/<input[^>]*tabindex="-1"[^>]*name="website"/);
  });

  it("carries the campaign marks as hidden fields", () => {
    const html = view({ status: "idle" }, { utm: { utm_source: "ads", utm_medium: "cpc" } });
    expect(html).toContain('name="utm_source" value="ads"');
    expect(html).toContain('name="utm_medium" value="cpc"');
  });

  it("offers the three scopes of the first release", () => {
    const html = view({ status: "idle" });
    for (const v of ["pc", "pc_periph", "setup"]) expect(html).toContain(`value="${v}"`);
    expect(html).not.toContain("podbor");
  });

  it("shows the answer of the server next to the fields, keeps what was typed, and puts the alert first", () => {
    const html = view({
      status: "error",
      code: "invalid",
      fields: { phone: "phone_invalid", consent: "consent_required", comment: "too_long" },
      values: { phone: "12345", name: "Aziz", scope: "setup", comment: "text" },
    });
    expect(html).toContain("Check the form");
    expect(html).toContain("Bad phone");
    expect(html).toContain("Consent first");
    expect(html).toContain("Too long");
    expect(html).toContain('value="12345"');
    expect(html).toContain('value="Aziz"');
    expect(html).toContain(">text</textarea>");
    expect(html).toContain("is-invalid");
    expect(html.indexOf('class="lead-error"')).toBeLessThan(html.indexOf('name="locale"'));
  });

  it("says in words why a request could not be taken", () => {
    for (const code of ["rate_limited", "unavailable", "failed"] as const) {
      const html = view({ status: "error", code, fields: {}, values: {} });
      expect(html).toContain(labels.errors[code]);
    }
  });

  it("thanks the visitor with the number of the request and a way to continue in Telegram", () => {
    const html = view({ status: "ok", number: "L-0007" });
    expect(html).toContain('role="status"');
    expect(html).toContain("Request L-0007 taken");
    expect(html).toContain("We will write.");
    expect(html).toContain('href="https://t.me/example_bot"');
    expect(html).not.toContain("<form");
  });

  it("thanks without a number for a request that was swallowed silently", () => {
    const html = view({ status: "ok", number: null });
    expect(html).toContain("Request taken");
    expect(html).not.toContain("{number}");
  });

  it("disables the button and says Sending while the request is on its way", () => {
    const html = view({ status: "idle" }, { pending: true });
    expect(html).toContain("Sending");
    expect(html).toMatch(/<button[^>]*disabled/);
  });
});

describe("LeadForm", () => {
  it("starts from the empty form (the state of the server action is idle)", () => {
    const html = renderToStaticMarkup(
      createElement(LeadForm, { labels, locale: "ru", utm: {}, consentNote: "note", botUrl: "https://t.me/x" }),
    );
    expect(html).toContain("Send");
    expect(html).toContain('value="ru"');
  });
});
