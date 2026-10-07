import type { AppLocale } from "@nivel/i18n";
import { Button } from "@nivel/ui/react";
import { getTranslations } from "next-intl/server";

export const BOT_URL = "https://t.me/niveluzbot";

const DOCS = [
  { slug: "offer", key: "footer.doc.offer" },
  { slug: "privacy", key: "footer.doc.privacy" },
  { slug: "warranty", key: "footer.doc.warranty" },
  { slug: "returns", key: "footer.doc.returns" },
  { slug: "consent-pd", key: "footer.doc.consentPd" },
  { slug: "stage-tariff", key: "footer.doc.stageTariff" },
] as const;

const SOURCES = {
  a1: "https://www.pexels.com/video/33356256/",
  a2: "https://www.pexels.com/video/30518577/",
  a3: "https://www.pexels.com/video/installing-a-processor-in-a-motherboard-socket-11537353/",
  a4: "https://www.pexels.com/video/hand-holding-a-computer-processor-12611453/",
  a5: "https://www.pexels.com/video/close-up-of-a-person-building-a-pc-11537350/",
} as const;

/** The footer: the promise, the contacts, the legal documents, the requisites (stubs until the registration), the sources of the stock video. */
export async function SiteFooter({
  locale,
  motionOff,
  withMotion,
}: {
  locale: AppLocale;
  motionOff: boolean;
  withMotion: boolean;
}) {
  const t = await getTranslations({ locale, namespace: "site" });
  const sources = Object.fromEntries(
    Object.entries(SOURCES).map(([tag, href]) => [
      tag,
      (chunks: React.ReactNode) => (
        <a href={href} rel="noopener noreferrer" target="_blank">
          {chunks}
        </a>
      ),
    ]),
  );
  const pending = t("footer.req.pending");
  return (
    <footer className="ftr">
      <div className="wrap">
        <div className="ftr-top">
          <div>
            <p className="pr">{t("footer.promise")}</p>
            <Button href={BOT_URL} target="_blank" rel="noopener" mark>
              {t("cta.telegram")}
            </Button>
          </div>
          <details className="ftr-d" open>
            <summary>
              <h4>{t("footer.contact")}</h4>
            </summary>
            <ul>
              <li>
                <a href={BOT_URL} target="_blank" rel="noopener">
                  {t("footer.bot")}
                </a>
              </li>
              <li>
                <a href="https://nivel.uz">nivel.uz</a>
              </li>
              <li>{t("footer.city")}</li>
            </ul>
          </details>
          <details className="ftr-d" open>
            <summary>
              <h4>{t("footer.docs")}</h4>
            </summary>
            <ul>
              {DOCS.map((d) => (
                <li key={d.slug}>
                  <a href={`/${locale}/legal/${d.slug}`}>{t(d.key)}</a>
                </li>
              ))}
            </ul>
          </details>
          <details className="ftr-d" open>
            <summary>
              <h4>{t("footer.reqTitle")}</h4>
            </summary>
            <p className="req">
              {t("footer.req.ip")}: <span>{pending}</span>
              <br />
              {t("footer.req.inn")}: <span>{pending}</span>
              <br />
              {t("footer.req.account")}: <span>{pending}</span>
              <br />
              {t("footer.req.address")}: <span>{pending}</span>
              <br />
              <a href={`/${locale}/requisites`}>{t("footer.req.link")}</a>
            </p>
          </details>
        </div>
        <details className="ftr-d" open>
          <summary>
            <h4>{t("footer.src.title")}</h4>
          </summary>
          <p className="note srcs">{t.rich("footer.src.text", sources)}</p>
        </details>
        <div className="ftr-bot">
          <span>{t("footer.note")}</span>
          {withMotion ? (
            <span>
              <button type="button" data-motion-toggle data-off={motionOff ? "1" : "0"}>
                {motionOff ? t("footer.motionOn") : t("footer.motionOff")}
              </button>
            </span>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
