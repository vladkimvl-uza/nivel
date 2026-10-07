import type { AppLocale } from "@nivel/i18n";
import { Button, LogoLockup } from "@nivel/ui/react";
import { getTranslations } from "next-intl/server";
import { FinaleSeat } from "./FinaleSeat.tsx";
import { BOT_URL } from "./SiteFooter.tsx";

/** The finale: a phrase and two buttons, below them the mark sits in its sockets («Fit to tolerance») and stays as the brand block of the footer. */
export async function Finale({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "site" });
  return (
    <section className="band band--fin" id="yakun" aria-labelledby="finH" data-band="fin">
      <div className="wrap">
        <div className="fin-box">
          <h2 id="finH">{t("final.title")}</h2>
          <p>{t("final.text")}</p>
          <div className="acts">
            <Button href={BOT_URL} target="_blank" rel="noopener" mark>
              {t("cta.telegram")}
            </Button>
            <Button href="#zayavka" variant="ghost">
              {t("cta.request")}
            </Button>
          </div>
        </div>
        <div className="fin-st" data-fin>
          <FinaleSeat fallback={<LogoLockup label={t("final.logo")} />} label={t("final.logo")} />
        </div>
      </div>
    </section>
  );
}
