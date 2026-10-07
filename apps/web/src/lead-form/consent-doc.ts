// What the consent to the processing of personal data points at: the text the visitor was shown next to the form. The page of the
// consent (`/legal/consent-pd`) shows the document of `content.legal_documents` when there is one, else the text built into the
// site; the evidence of the consent (ARCHITECTURE 10.2: version, fingerprint of the text, language) must name the same one, or it
// would name a text the visitor never saw. The log of consents is append-only, so a wrong record cannot be mended later.
import { createHash } from "node:crypto";
import type { LegalResolution } from "../i18n/site/data.ts";
import { loadMessages } from "../i18n/site-messages.ts";
import { BUILTIN_PD_CONSENT_VERSION } from "./form.ts";

export interface ConsentRef {
  textVersion: string;
  textSha256: string;
  /** Set when the text is a document of the database. */
  documentId?: string;
}

/** SHA-256 of "title, line break, body" of the built-in text (the same string as in consent-version.test.ts). */
export function builtinConsentRef(locale: "uz" | "ru"): ConsentRef {
  const consent = (loadMessages(locale).site as unknown as { legal: { consentPd: { title: string; body: string } } })
    .legal.consentPd;
  const sha = createHash("sha256").update(`${consent.title}\n${consent.body}`, "utf8").digest("hex");
  return { textVersion: BUILTIN_PD_CONSENT_VERSION, textSha256: sha };
}

/** The reference for what the page of the consent shows (`resolveLegal` of the same document and language). */
export function consentRefOf(found: LegalResolution, locale: "uz" | "ru"): ConsentRef {
  if (found.source === "builtin") return builtinConsentRef(locale);
  return { textVersion: found.version, textSha256: found.sha256, documentId: found.id };
}
