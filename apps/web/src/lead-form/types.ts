// Shapes shared by the request form, its server action and the gateway to the services (WP-16, ARCHITECTURE 5.1).

/** What the form offers; `podbor` (selection without purchase) is sold only when the owner allows it (DECISIONS R-26). */
export const FORM_SCOPES = ["pc", "pc_periph", "setup"] as const;
export type FormScope = (typeof FORM_SCOPES)[number];

export type FieldName = "name" | "phone" | "telegram" | "scope" | "district" | "budget" | "comment" | "consent";

/** Machine codes; the page turns them into words of the visitor's language (`site.form.errors.<code>`). */
export type FieldErrorCode =
  | "required"
  | "phone_invalid"
  | "contact_required"
  | "telegram_invalid"
  | "too_long"
  | "budget_invalid"
  | "scope_invalid"
  | "consent_required"
  | "rejected";

export type FieldErrors = Partial<Record<FieldName, FieldErrorCode>>;

/** What the visitor typed, to show it again next to an error. */
export interface LeadFormValues {
  name: string;
  phone: string;
  telegram: string;
  scope: string;
  district: string;
  budget: string;
  comment: string;
  /** "on" when the consent was ticked: the form shows it ticked again after an answer, since React resets the form. */
  consent?: "on";
}

/** The request as the services want it from the site: no ids of customers, no Telegram id (the database refuses them). */
export interface LeadCommand {
  channel: "web";
  scope: FormScope;
  lang: "uz" | "ru";
  district?: string;
  /** Whole sums; a wish of the visitor, never a price. */
  budgetSum?: number;
  comment?: string;
  utm?: Record<string, string>;
  customer: { displayName?: string; phoneE164?: string; telegramUsername?: string };
  /** The consent to the processing of personal data, ticked in the form (`ops.consents`, kind pd_processing). */
  consent: {
    kind: "pd_processing";
    granted: true;
    /** The version of the text the visitor was shown: of the document of the database, else of the built-in text. */
    textVersion: string;
    /** SHA-256 of that text (ARCHITECTURE 10.2); set by processLeadForm, not by the parser. */
    textSha256?: string;
    /** content.legal_documents.id of the document, when the page showed one of the database. */
    documentId?: string;
  };
}

export type LeadActionState =
  | { status: "idle" }
  /** `number` is empty for a request that was swallowed silently (the trap for bots): the page says the same words. */
  | { status: "ok"; number: string | null }
  | {
      status: "error";
      code: "invalid" | "rate_limited" | "unavailable" | "failed";
      fields: FieldErrors;
      values: Partial<LeadFormValues>;
    };

export const IDLE: LeadActionState = { status: "idle" };
