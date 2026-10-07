import { isLocale } from "@nivel/i18n";
import { Badge } from "@nivel/ui/react";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { alternatesFor } from "../../../../src/i18n/paths.ts";
import { resolveLegal, todayInTashkent } from "../../../../src/i18n/site/data.ts";
import { legalKindOf, legalMessageKey } from "../../../../src/i18n/site/legal.ts";
import { priceParams } from "../../../../src/i18n/site/params.ts";
import { MOTION_COOKIE, readMotionPrefs } from "../../../../src/i18n/site/prefs.ts";
import { LegalBody } from "../../(marketing)/_components/LegalBody.tsx";
import { SiteFrame } from "../../(marketing)/_components/SiteFrame.tsx";
import { getFeeScale, getLegalRows } from "../../(marketing)/_data/server.ts";

type Props = { params: Promise<{ locale: string; doc: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, doc } = await params;
  const key = legalMessageKey(doc);
  if (!isLocale(locale) || !key) return {};
  const t = await getTranslations({ locale, namespace: "site.legal" });
  const title = t(`${key}.title`);
  return {
    title,
    description: t("metaDescription", { title }),
    alternates: { ...alternatesFor(`/legal/${doc}`), canonical: `/${locale}/legal/${doc}` },
  };
}

/** `/[locale]/legal/[doc]`: offer, privacy policy, warranty, returns, consent, tariff of the stages. A draft carries its plaque. */
export default async function LegalPage({ params }: Props) {
  const { locale, doc } = await params;
  const kind = legalKindOf(doc);
  const key = legalMessageKey(doc);
  if (!isLocale(locale) || !kind || !key) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "site" });
  const [{ scale }, rows, store, h] = await Promise.all([getFeeScale(), getLegalRows(kind), cookies(), headers()]);
  const prefs = readMotionPrefs(store.get(MOTION_COOKIE)?.value, h.get("save-data"));
  const found = resolveLegal(rows, kind, locale, todayInTashkent());
  const p = priceParams(scale, locale);
  const body = found.source === "db" ? found.bodyMd : t(`legal.${key}.body`, p);

  return (
    <SiteFrame locale={locale} path={`/legal/${doc}`} motionOff={prefs.motionOff} withMotion={false}>
      <main className="legal" id="top">
        <div className="wrap legal-wrap">
          <a className="legal-back" href={`/${locale}`}>
            {t("legal.back")}
          </a>
          <h1>{t(`legal.${key}.title`)}</h1>
          {found.draft ? (
            <div className="legal-draft">
              <Badge kind="draft" label={t("legal.draft")} />
              <p>{t("legal.draftNote")}</p>
            </div>
          ) : null}
          <p className="legal-meta">
            {found.source === "db" ? (
              <>
                <span>{t("legal.version", { version: found.version })}</span>
                {found.effectiveFrom ? (
                  <span>{t("legal.effective", { date: found.effectiveFrom.split("-").reverse().join(".") })}</span>
                ) : null}
                <span className="legal-hash">{t("legal.hash", { hash: found.sha256 })}</span>
              </>
            ) : (
              <span>{t("legal.builtin")}</span>
            )}
          </p>
          <LegalBody markdown={body} />
        </div>
      </main>
    </SiteFrame>
  );
}
