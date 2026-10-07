import { isLocale } from "@nivel/i18n";
import { Badge } from "@nivel/ui/react";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { alternatesFor } from "../../../src/i18n/paths.ts";
import { resolveLegal, todayInTashkent } from "../../../src/i18n/site/data.ts";
import { MOTION_COOKIE, readMotionPrefs } from "../../../src/i18n/site/prefs.ts";
import { LegalBody } from "../(marketing)/_components/LegalBody.tsx";
import { SiteFrame } from "../(marketing)/_components/SiteFrame.tsx";
import { getLegalRows } from "../(marketing)/_data/server.ts";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "site.requisites" });
  return {
    title: t("title"),
    description: t("lead"),
    alternates: { ...alternatesFor("/requisites"), canonical: `/${locale}/requisites` },
  };
}

const ROWS = ["ip", "inn", "account", "funds", "bank", "address"] as const;

/**
 * `/[locale]/requisites`: the requisites of the sole proprietor. Until the registration every value is «after the registration»
 * (the stub of the owner's decision); a published document of the kind `requisites` in the database is shown below the table.
 */
export default async function RequisitesPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "site" });
  const [rows, store, h] = await Promise.all([getLegalRows("requisites"), cookies(), headers()]);
  const prefs = readMotionPrefs(store.get(MOTION_COOKIE)?.value, h.get("save-data"));
  const found = resolveLegal(rows, "requisites", locale, todayInTashkent());
  const pending = t("footer.req.pending");

  return (
    <SiteFrame locale={locale} path="/requisites" motionOff={prefs.motionOff} withMotion={false}>
      <main className="legal" id="top">
        <div className="wrap legal-wrap">
          <a className="legal-back" href={`/${locale}`}>
            {t("legal.back")}
          </a>
          <h1>{t("requisites.title")}</h1>
          <div className="legal-draft">
            <Badge kind="draft" label={t("legal.draft")} />
            <p>{t("requisites.lead")}</p>
          </div>
          <dl className="req-table">
            {ROWS.map((r) => (
              <div key={r}>
                <dt>{t(`requisites.row.${r}`)}</dt>
                <dd>{pending}</dd>
              </div>
            ))}
            <div>
              <dt>{t("requisites.row.contact")}</dt>
              <dd>{t("requisites.row.contactValue")}</dd>
            </div>
            <div>
              <dt>{t("requisites.row.site")}</dt>
              <dd>{t("requisites.row.siteValue")}</dd>
            </div>
          </dl>
          <p className="legal-meta">
            <span>{t("requisites.note")}</span>
          </p>
          {found.source === "db" ? <LegalBody markdown={found.bodyMd} /> : null}
        </div>
      </main>
    </SiteFrame>
  );
}
