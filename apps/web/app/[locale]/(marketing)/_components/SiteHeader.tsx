import type { AppLocale } from "@nivel/i18n";
import { locales } from "@nivel/i18n";
import { Button, LogoLockup } from "@nivel/ui/react";
import { getTranslations } from "next-intl/server";

const NAV = [
  { href: "#kak-rabotaem", key: "nav.how" },
  { href: "#ceny", key: "nav.prices" },
  { href: "#zayavka", key: "nav.request" },
] as const;

/**
 * The fixed header: the logo, the sections of the one page, the language switch (the same path in the other language), the
 * call to action. Links to sections carry the path of the home page, so that they work on the legal pages too. The menu of a
 * phone is a native `<details>`: it opens without a script.
 */
export async function SiteHeader({ locale, path = "" }: { locale: AppLocale; path?: string }) {
  const t = await getTranslations({ locale, namespace: "site" });
  const home = `/${locale}`;
  return (
    <header className="hdr" data-hdr>
      <div className="wrap">
        <a className="logo" href={home} aria-label={t("header.home")}>
          <LogoLockup decorative />
        </a>
        <nav className="nav" aria-label={t("header.nav")}>
          {NAV.map((n) => (
            <a key={n.href} href={`${home}${n.href}`} data-nav={n.href}>
              {t(n.key)}
            </a>
          ))}
        </nav>
        {/* biome-ignore lint/a11y/useSemanticElements: a row of links of the language switch, not a form group */}
        <div className="seg2 lang" role="group" aria-label={t("header.lang")}>
          {locales.map((l) => (
            <a
              key={l}
              href={`/${l}${path}`}
              hrefLang={l === "uz" ? "uz-Latn" : "ru"}
              lang={l === "uz" ? "uz-Latn" : "ru"}
              aria-label={t(l === "uz" ? "header.langUz" : "header.langRu")}
              aria-current={l === locale ? "true" : undefined}
            >
              {l.toUpperCase()}
            </a>
          ))}
        </div>
        <Button className="hdr-cta" href={`${home}#zayavka`} size="sm" mark>
          {t("cta.request")}
        </Button>
        <details className="menu" data-menu>
          <summary className="burger" aria-label={t("header.menu")}>
            <span />
          </summary>
          <nav className="sheet" aria-label={t("header.nav")}>
            {NAV.map((n) => (
              <a key={n.href} href={`${home}${n.href}`}>
                {t(n.key)}
              </a>
            ))}
            <Button href={`${home}#zayavka`} mark>
              {t("cta.request")}
            </Button>
          </nav>
        </details>
      </div>
    </header>
  );
}
