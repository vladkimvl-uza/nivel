import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { LegalResolution } from "../i18n/site/data.ts";
import { loadMessages } from "../i18n/site-messages.ts";
import { builtinConsentRef, consentRefOf } from "./consent-doc.ts";
import { BUILTIN_PD_CONSENT_VERSION } from "./form.ts";

const db = (over: Partial<Extract<LegalResolution, { source: "db" }>> = {}): LegalResolution => ({
  source: "db",
  draft: false,
  version: "2026-11-01",
  effectiveFrom: "2026-11-01",
  sha256: "c".repeat(64),
  bodyMd: "text",
  id: "11111111-1111-4111-8111-111111111111",
  ...over,
});

describe("consentRefOf", () => {
  it("names the document of the database that the page shows: its id, version and fingerprint", () => {
    expect(consentRefOf(db(), "uz")).toEqual({
      textVersion: "2026-11-01",
      textSha256: "c".repeat(64),
      documentId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("names a stub of the database too: it is what the visitor read", () => {
    expect(consentRefOf(db({ draft: true, version: "0" }), "ru")).toMatchObject({
      textVersion: "0",
      documentId: expect.any(String),
    });
  });

  it("names the built-in text when the database has no document", () => {
    expect(consentRefOf({ source: "builtin", draft: true }, "uz")).toEqual(builtinConsentRef("uz"));
  });
});

describe("builtinConsentRef", () => {
  it.each(["uz", "ru"] as const)(
    "is the fingerprint of the title and the body of the built-in consent (%s)",
    (locale) => {
      const consent = (
        loadMessages(locale).site as unknown as { legal: { consentPd: { title: string; body: string } } }
      ).legal.consentPd;
      const sha = createHash("sha256").update(`${consent.title}\n${consent.body}`, "utf8").digest("hex");
      expect(builtinConsentRef(locale)).toEqual({ textVersion: BUILTIN_PD_CONSENT_VERSION, textSha256: sha });
    },
  );
});
