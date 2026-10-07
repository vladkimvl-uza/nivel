import type { AppLocale } from "@nivel/i18n";
import { Mark, Money } from "@nivel/ui/react";
import { getTranslations } from "next-intl/server";
import type { FeeScale } from "../../../../src/i18n/site/fee-scale.ts";
import { formatSumsOf } from "../../../../src/i18n/site/format.ts";
import { SAMPLE_ITEMS, sampleOrder } from "../../../../src/i18n/site/sample-order.ts";

/** The shops of the nine sample receipts (invented, the receipts say «sample»). */
const SHOPS = "AABBACBCC";

/** `--x`, `--y`, `--r` of a receipt: they lie in a loose stack on the table, the same way every time. */
function receiptStyle(i: number): Record<string, string> {
  return {
    "--x": `${(i % 3) * 7 - 7}px`,
    "--y": `${i * 4}px`,
    "--r": `${((((i * 37) % 9) - 4) * 0.55).toFixed(2)}deg`,
  };
}

/**
 * The three pinned scenes of the background between «How we work» and the passport: the purchase (receipts on the table),
 * the assembly (the list of parts of the estimate), the test (the clock of eight hours). The scenes hold the place; the
 * clip of each stage plays behind them (bg-controller).
 */
export async function Bands({ locale, scale }: { locale: AppLocale; scale: FeeScale }) {
  const t = await getTranslations({ locale, namespace: "site" });
  const order = sampleOrder(scale);
  return (
    <>
      <section className="band band--x" id="xarid" aria-label={t("band.x.aria")} data-band="xarid">
        <div className="band-st">
          <div className="wrap">
            <p className="band-l">
              <Mark />
              <span data-band-label>{t("band.x.label", { n: 0 })}</span>
            </p>
            <div className="rcs-sum" data-rcs-sum aria-hidden="true">
              <span className="s">{t("rc.sum", { n: 0, sum: formatSumsOf(0, locale) })}</span>
              <span className="ret">{t("rc.refund", { sum: formatSumsOf(order.refund, locale) })}</span>
            </div>
            <div className="rcs" data-rcs aria-hidden="true">
              {SAMPLE_ITEMS.map((item, i) => (
                <div key={item.id} className="rc" style={receiptStyle(i) as React.CSSProperties}>
                  <div className="h">
                    <span>{t("rc.shop", { s: SHOPS[i] ?? "A" })}</span>
                    <span>{`${i < 5 ? "06" : "07"}.10.2026`}</span>
                  </div>
                  <div className="i">
                    <span>{t(`items.${item.id}.name`)}</span>
                    <Money amount={item.receipt} />
                  </div>
                  <div className="i">
                    <span>{t("rc.qty")}</span>
                    <span>1</span>
                  </div>
                  <div className="t">
                    <span>{t("rc.total")}</span>
                    <Money amount={item.receipt} />
                  </div>
                  <span className="nm">{t("rc.sample")}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="band band--y" id="yigish" aria-label={t("band.y.aria")} data-band="yig">
        <div className="band-st">
          <div className="wrap">
            <p className="band-l">
              <Mark />
              <span data-band-label>{t("band.y.label", { k: 0 })}</span>
            </p>
            <ol className="asm" data-asm aria-hidden="true">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                <li key={i}>{t(`bg.asm.${i}`)}</li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="band band--t" id="sinov" aria-label={t("band.t.aria")} data-band="sin">
        <div className="band-st">
          <div className="wrap">
            <p className="band-l">
              <Mark />
              <span data-band-label>{t("band.t.label")}</span>
            </p>
            <p className="tclk" data-tclk aria-hidden="true">
              <span className="c">
                <b data-tclk-h>00:00</b>
                <span>{t("band.t.of")}</span>
              </span>
              <span>{t("band.t.clock")}</span>
              <span className="ok" data-tclk-ok>
                {t("band.t.ok")}
              </span>
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
