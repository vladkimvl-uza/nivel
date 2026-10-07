import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadMessages } from "../i18n/site-messages.ts";
import { BUILTIN_PD_CONSENT_VERSION } from "./form.ts";

// The version of the consent text is written into the evidence of every request (ops.consents). When the text of the consent
// changes, the version must change with it, or the evidence would name a text the visitor never saw. Change the text, change
// BUILTIN_PD_CONSENT_VERSION in form.ts, and update both fingerprints below in the same commit.
const TEXT_FINGERPRINT = {
  uz: "735d6589ed3fab9fb9f949b757636312c6281cc273190104067167e0bc679f18",
  ru: "77e866e8c3340ff4ca7cc0df080e389fd6107a8a03a4d592444faf2d72b1f7aa",
} as const;
const VERSION_OF_THOSE_TEXTS = "builtin-2026-10-07";

function fingerprint(locale: "uz" | "ru"): string {
  const consent = (loadMessages(locale).site as unknown as { legal: { consentPd: { title: string; body: string } } })
    .legal.consentPd;
  return createHash("sha256")
    .update(
      `${consent.title}
${consent.body}`,
      "utf8",
    )
    .digest("hex");
}

describe("the version of the consent text", () => {
  it("is the version these texts were written under", () => {
    expect(BUILTIN_PD_CONSENT_VERSION).toBe(VERSION_OF_THOSE_TEXTS);
  });

  for (const locale of ["uz", "ru"] as const) {
    it(`changes together with the consent text (${locale})`, () => {
      expect(fingerprint(locale)).toBe(TEXT_FINGERPRINT[locale]);
    });
  }
});
