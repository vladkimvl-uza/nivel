import type { AppLocale } from "@nivel/i18n";
import { Button, Mark } from "@nivel/ui/react";
import { getTranslations } from "next-intl/server";
import { LeadForm, type LeadFormLabels } from "../../../../src/lead-form/LeadForm.tsx";
import type { FieldErrorCode } from "../../../../src/lead-form/types.ts";
import { getLeadFormEnabled } from "../_data/server.ts";
import { BOT_URL } from "./SiteFooter.tsx";

const FIELD_ERRORS: readonly FieldErrorCode[] = [
  "required",
  "phone_invalid",
  "contact_required",
  "telegram_invalid",
  "too_long",
  "budget_invalid",
  "scope_invalid",
  "consent_required",
  "rejected",
];

/** «Request»: the form that creates a lead (`submitLead`) and, beside it, the bot. */
export async function RequestSection({ locale, utm }: { locale: AppLocale; utm: Record<string, string> }) {
  const t = await getTranslations({ locale, namespace: "site" });
  const enabled = await getLeadFormEnabled().catch(() => false);
  const labels: LeadFormLabels = {
    name: t("form.name"),
    phone: t("form.phone"),
    phoneHint: t("form.phoneHint"),
    telegram: t("form.telegram"),
    telegramHint: t("form.telegramHint"),
    scope: t("form.scopeLabel"),
    scopePlaceholder: t("form.scopePlaceholder"),
    scopes: { pc: t("form.scope.pc"), pc_periph: t("form.scope.pc_periph"), setup: t("form.scope.setup") },
    district: t("form.district"),
    budget: t("form.budget"),
    budgetHint: t("form.budgetHint"),
    comment: t("form.comment"),
    commentHint: t("form.commentHint"),
    website: t("form.website"),
    consent: t("form.consent"),
    submit: t("form.submit"),
    sending: t("form.sending"),
    okTitle: t("form.okTitle", { number: "{number}" }),
    okTitleNoNumber: t("form.okTitleNoNumber"),
    okText: t("form.okText"),
    or: t("form.or"),
    telegramButton: t("cta.telegram"),
    errors: {
      invalid: t("form.error.invalid"),
      rate_limited: t("form.error.rate_limited"),
      unavailable: t("form.error.unavailable"),
      failed: t("form.error.failed"),
    },
    fieldErrors: Object.fromEntries(FIELD_ERRORS.map((c) => [c, t(`form.fieldError.${c}`)])) as Record<
      FieldErrorCode,
      string
    >,
  };
  const consentNote = t.rich("form.consentLinks", {
    priv: (chunks) => <a href={`/${locale}/legal/privacy`}>{chunks}</a>,
    cons: (chunks) => <a href={`/${locale}/legal/consent-pd`}>{chunks}</a>,
  });
  return (
    <section className="sec request" id="zayavka">
      <div className="wrap">
        <div className="sec-head">
          <div>
            <p className="kicker">
              <Mark />
              <span>{t("form.kicker")}</span>
            </p>
            <h2 className="h2">{t("form.title")}</h2>
            <p className="lead">{t("form.lead")}</p>
          </div>
        </div>
        <div className="lead-box">
          {enabled ? (
            <LeadForm labels={labels} locale={locale} utm={utm} consentNote={consentNote} botUrl={BOT_URL} />
          ) : (
            <div className="lead-ok" data-lead-off>
              <h3>{t("form.offTitle")}</h3>
              <p>{t("form.offText")}</p>
              <Button href={BOT_URL} target="_blank" rel="noopener" mark>
                {t("cta.telegram")}
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
