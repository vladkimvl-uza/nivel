import { isLocale, locales } from "@nivel/i18n";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

// WP-00 placeholder; the R0 one-page site is built by WP-16 on semantic tokens (theme B).
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "common" });

  return (
    <main className="page">
      <p className="badge">{t("home.draft")}</p>
      <h1>{t("home.heading")}</h1>
      <p className="lead">{t("home.lead")}</p>
      <nav aria-label={t("lang.switch")} className="langs">
        {locales.map((l) => (
          <Link key={l} href={`/${l}`} hrefLang={l} aria-current={l === locale ? "page" : undefined}>
            {t(`lang.${l}`)}
          </Link>
        ))}
      </nav>
    </main>
  );
}
