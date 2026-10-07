import type { AppLocale } from "@nivel/i18n";
import { Button, Mark, Money } from "@nivel/ui/react";
import { getTranslations } from "next-intl/server";
import type { FeeScale } from "../../../../src/i18n/site/fee-scale.ts";
import { posterPath } from "../../../../src/i18n/site/hero-model.ts";
import { mediaUrl } from "../../../../src/i18n/site/media-url.ts";
import { priceParams } from "../../../../src/i18n/site/params.ts";
import { SAMPLE_ITEMS, sampleOrder } from "../../../../src/i18n/site/sample-order.ts";
import { BOT_URL } from "./SiteFooter.tsx";

/** A one-pixel transparent GIF: under `prefers-reduced-motion` the poster of the pinned scroll is not needed, and not downloaded. */
const BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=";

const CAPS = [0, 1, 2, 3, 4] as const;

/** Rows of the small estimate next to the second step: the seven main parts, then the case with its fans in one line. */
const HDOC_ROWS = ["cpu", "mb", "cool", "ram", "gpu", "ssd", "psu"] as const;

/**
 * The first screen (docs/design/hero-video): the clips of the owner scrubbed by the scroll, four steps. The server draws the
 * poster of the first step and the captions; the script (loaded after the page is idle) moves them. Served static, the same
 * markup is a list of four stills.
 */
export async function Hero({
  locale,
  mediaBase,
  reduced,
  scale,
}: {
  locale: AppLocale;
  mediaBase: string;
  /** The page is served static (the visitor switched the animation off, or the browser saves traffic): no pinned poster. */
  reduced: boolean;
  scale: FeeScale;
}) {
  const t = await getTranslations({ locale, namespace: "site" });
  const p = priceParams(scale, locale);
  const order = sampleOrder(scale);
  const est = (id: string) => SAMPLE_ITEMS.find((i) => i.id === id)?.estimate ?? 0;
  const src = (step: number, size: "m" | "1280" | "1920") => mediaUrl(mediaBase, posterPath(step, "brand", size));
  const stepNames = [0, 1, 2, 3].map((i) => t(`hero.steps.s${i}`));
  const bare = (name: string | undefined) => (name ?? "").replace(/^\d\d /, "");
  const captionText = [
    t("hero.c0.text"),
    t("hero.c1.text", { hours: p.hours }),
    t("hero.c2.text", p),
    t("hero.c3.text"),
    t("hero.c4.text", p),
  ];
  const actions = (
    <div className="acts">
      <Button href="#zayavka" mark>
        {t("cta.request")}
      </Button>
      <Button href={BOT_URL} variant="ghost" target="_blank" rel="noopener">
        <span className="tg-long">{t("cta.telegram")}</span>
        <span className="tg-short">{t("cta.telegramShort")}</span>
      </Button>
    </div>
  );

  return (
    <section className="hero" id="hero" aria-label={t("hero.label")} data-hero>
      <div className="hero-track" data-hero-track>
        <div className="hero-stage">
          {reduced ? null : (
            <div className="hero-media" data-hero-media aria-hidden="true">
              <div className="pstack">
                <picture>
                  <source media="(prefers-reduced-motion: reduce)" srcSet={BLANK} />
                  <source media="(max-width: 859px), (pointer: coarse)" srcSet={src(0, "m")} />
                  <source media="(min-width: 1600px) and (min-resolution: 2dppx)" srcSet={src(0, "1920")} />
                  <img
                    className="is-on"
                    src={src(0, "1280")}
                    alt=""
                    decoding="async"
                    fetchPriority="high"
                    data-poster="0"
                  />
                </picture>
                {[1, 2, 3].map((i) => (
                  <img key={i} alt="" decoding="async" data-poster={i} />
                ))}
              </div>
            </div>
          )}
          <div className="hero-shade" aria-hidden="true" />
          <div className="hero-off" data-hero-off aria-hidden="true" />
          <a className="skip" href="#kak-rabotaem">
            {t("skip")}
          </a>
          <div className="hero-copy">
            {CAPS.map((i) => {
              const Title = i === 0 ? "h1" : "h2";
              return (
                <div key={i} className={`cap${i === 0 ? " is-on" : ""}`} data-cap={i}>
                  <p className="eyebrow">
                    {i === 0 ? <Mark /> : <span className="nv-num">{`0${i} / 04`}</span>}
                    <span>{t(`hero.c${i}.eyebrow`)}</span>
                  </p>
                  <Title>{t(`hero.c${i}.title`)}</Title>
                  <p>{captionText[i]}</p>
                  {i === 2 ? <p className="cap-note">{t("hero.c2.note", p)}</p> : null}
                  {i === 0 || i === 4 ? actions : null}
                </div>
              );
            })}
          </div>
          <aside className="nv-paper hdoc" data-hdoc aria-hidden="true">
            <div className="ph">
              <div>
                <h3>{t("hero.hdoc.title")}</h3>
                <div className="pm">{t("hero.hdoc.meta", { date: p.date })}</div>
              </div>
            </div>
            <table className="nv-est">
              <tbody>
                {HDOC_ROWS.map((id) => (
                  <tr key={id}>
                    <td>{t(`items.${id}.name`)}</td>
                    <td className="nv-est__amount">
                      <Money amount={est(id)} />
                    </td>
                  </tr>
                ))}
                <tr>
                  <td>{t("hero.hdoc.caseFans")}</td>
                  <td className="nv-est__amount">
                    <Money amount={est("case") + est("fans")} />
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="big">
                  <td>{t("hero.hdoc.parts")}</td>
                  <td className="nv-est__amount">
                    <Money amount={order.partsEstimate} />
                  </td>
                </tr>
                <tr>
                  <td>{t("hero.hdoc.fee")}</td>
                  <td className="nv-est__amount">
                    <Money amount={order.fee} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </aside>
          <div className="hfoot" data-hfoot>
            <p className="ill">{t("illustration")}</p>
            <ol className="steps" data-steps aria-hidden="true">
              <li className="steps-now" data-steps-now>
                {t("hero.stepNow", { n: "01", name: bare(stepNames[0]) })}
              </li>
              {stepNames.map((name, i) => (
                <li key={name} className={i === 0 ? "is-on" : undefined} data-step-i={i}>
                  <i>
                    <b />
                  </i>
                  <span>{name}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
      <div className="hero-list">
        <div className="wrap">
          <div className="grid">
            {[0, 1, 2, 3].map((i) => (
              <figure key={i}>
                <img loading="lazy" decoding="async" src={src(i, "1280")} alt={t("hero.listAlt", { n: i + 1 })} />
                <figcaption>
                  <b>{`0${i + 1} · ${bare(stepNames[i])}`}</b>
                  {t(`hero.c${i + 1}.title`)}
                </figcaption>
              </figure>
            ))}
          </div>
          <p className="note hero-list-note">{t("hero.listNote")}</p>
        </div>
      </div>
    </section>
  );
}
