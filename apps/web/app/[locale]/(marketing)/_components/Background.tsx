import type { AppLocale } from "@nivel/i18n";
import { getTranslations } from "next-intl/server";
import type { CSSProperties } from "react";

/**
 * The fixed layers behind the page below the first screen: the stage (two images that take turns, the clip of the stage on top),
 * the shading, the grain, the ruler «Course of the order» under the header, the level line and the caption «Illustration».
 * All of it starts hidden and is run by bg-controller.
 */
export async function Background({ locale, grain }: { locale: AppLocale; grain: string }) {
  const t = await getTranslations({ locale, namespace: "site" });
  return (
    <>
      <div className="ob" data-ob aria-hidden="true" style={{ "--grain": `url(${grain})` } as CSSProperties}>
        <div className="ob-sc" data-ob-scene>
          <img alt="" decoding="async" />
          <img alt="" decoding="async" />
        </div>
        <div className="ob-sh l" />
        <div className="ob-sh u" />
        <div className="ob-sh c" />
        <div className="ob-sh w" data-ob-win />
        <div className="ob-gr" />
      </div>
      <div className="ord" data-ord aria-hidden="true">
        <div className="ord-in">
          <span className="ord-id">
            <span className="l">{t("ruler.idLong")}</span>
            <span className="sh">{t("ruler.idShort")}</span>
          </span>
          <ol className="ord-t" data-ord-t>
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <li key={i}>
                <b>{`0${i}`}</b>
                <span>{t(`bg.stage.${i}`)}</span>
              </li>
            ))}
          </ol>
          <span className="ord-s" data-ord-s />
          <i className="ord-cw" />
          <span className="ord-st" data-ord-st />
        </div>
      </div>
      <i className="ord-lv" data-ord-lv aria-hidden="true" />
      <p className="ob-il" data-ob-il aria-hidden="true">
        {t("illustration")}
      </p>
    </>
  );
}
