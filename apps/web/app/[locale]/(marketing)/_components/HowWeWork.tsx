import type { AppLocale } from "@nivel/i18n";
import { formatAmount } from "@nivel/ui";
import { Badge, LogoMark, Money, Paper, Stamp } from "@nivel/ui/react";
import { getTranslations } from "next-intl/server";
import { type FeeScale, salePercent } from "../../../../src/i18n/site/fee-scale.ts";
import { formatSumsOf } from "../../../../src/i18n/site/format.ts";
import { priceParams } from "../../../../src/i18n/site/params.ts";
import { SAMPLE_ITEMS, sampleOrder } from "../../../../src/i18n/site/sample-order.ts";
import { richTags } from "./rich.tsx";

const STEPS = [1, 2, 3, 4, 5, 6] as const;
/** Map of the four steps of the first screen onto the six steps of the order: [name of the step, columns, "→ 01"]. */
const RMAP = [
  { name: 0, span: 1, to: "→ 01" },
  { name: 1, span: 2, to: "→ 02–03" },
  { name: 2, span: 1, to: "→ 04" },
  { name: 3, span: 2, to: "→ 05–06" },
] as const;

/** «How we work»: the promise, the six steps with a document, a date and a stamp each, and two sample documents of order NV-0001. */
export async function HowWeWork({ locale, scale }: { locale: AppLocale; scale: FeeScale }) {
  const t = await getTranslations({ locale, namespace: "site" });
  const p = priceParams(scale, locale);
  const order = sampleOrder(scale);
  const sampleBadge = <Badge kind="sample" label={t("docs.sample")} />;
  const feeLine =
    scale.pcThreshold <= order.partsEstimate
      ? t("docs.est.feeHigh", {
          rate: p.highRate,
          byRate: formatAmount(order.feeByRate),
          min: formatAmount(scale.pcHighMinFee),
        })
      : t("docs.est.feeLow", { rate: p.lowRate });

  return (
    <section className="sec" id="kak-rabotaem">
      <div className="wrap">
        <div className="promise rv">
          {(["p1", "p2", "p3"] as const).map((k) => (
            <div key={k}>
              <b>{t(`promise.${k}.title`)}</b>
              <p>{t.rich(`promise.${k}.text`, { ...richTags, hours: p.hours })}</p>
            </div>
          ))}
        </div>
        <div className="win" aria-hidden="true">
          <p>
            <span className="nv-mk" />
            <span>{t("how.win1")}</span>
          </p>
        </div>
        <div className="sec-head">
          <div>
            <p className="kicker">
              <span className="nv-mk" aria-hidden="true" />
              <span>{t("nav.how")}</span>
            </p>
            <h2 className="h2">{t("how.title")}</h2>
            <p className="lead">{t("how.lead")}</p>
          </div>
        </div>
        <p className="note rmap-l">{t("how.map")}</p>
        <ol className="rmap">
          {RMAP.map((m) => (
            <li key={m.name} style={m.span > 1 ? { gridColumn: `span ${m.span}` } : undefined}>
              <i />
              <b>{t(`hero.steps.s${m.name}`)}</b>
              <span>{m.to}</span>
            </li>
          ))}
        </ol>
        <ol className="route">
          {STEPS.map((n) => (
            <li key={n} className="step" data-step>
              <Stamp
                variant="small"
                word={t(`route.st${n}.stamp`)}
                meta={t(`route.st${n}.date`)}
                tilt={n % 2 === 0 ? "right" : "left"}
                className="step-stamp"
                decorative
              />
              <span className="n">{`0${n}`}</span>
              <h3>{t(`route.st${n}.title`)}</h3>
              <p>{t(`route.st${n}.text`, p)}</p>
              <input type="checkbox" className="step-cb nv-sr" id={`step-${n}`} />
              <label className="step-tg" htmlFor={`step-${n}`}>
                <span>{t("route.toggle")}</span>
                <svg viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M1.5 3.2 5 6.8l3.5-3.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </label>
              <dl>
                <dt>{t("route.term")}</dt>
                <dd>{t(`route.st${n}.term`, p)}</dd>
                <dt>{t("route.money")}</dt>
                <dd>{t(`route.st${n}.money`, p)}</dd>
                <dt>{t("route.doc")}</dt>
                <dd>{t(`route.st${n}.doc`)}</dd>
              </dl>
            </li>
          ))}
        </ol>
        <div className="route-foot">
          <div>{t.rich("route.foot1", richTags)}</div>
          <div>{t.rich("route.foot2", richTags)}</div>
          <div className="note">{t("route.foot3")}</div>
        </div>
        <div className="win" aria-hidden="true">
          <p>
            <span className="nv-mk" />
            <span>{t("how.win2")}</span>
          </p>
        </div>

        <div className="docs">
          <div className="rv" id="docEst">
            <Paper badge={sampleBadge} tilt="left">
              <div className="ph">
                <div>
                  <h3>{t("docs.est.heading")}</h3>
                  <div className="pm">
                    {t("docs.est.meta1")}
                    <br />
                    {t("docs.est.meta2")}
                  </div>
                </div>
                <LogoMark decorative width={30} />
              </div>
              <table className="nv-est">
                <caption className="nv-sr">{t("docs.est.caption")}</caption>
                <thead>
                  <tr>
                    <th scope="col" className="nv-est__i">
                      {t("docs.est.colIndex")}
                    </th>
                    <th scope="col">{t("docs.est.colName")}</th>
                    <th scope="col" className="nv-est__amount">
                      {t("docs.est.colAmount")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {SAMPLE_ITEMS.map((item, i) => (
                    <tr key={item.id} className="nv-est__row">
                      <td className="nv-est__i">{String(i + 1)}</td>
                      <td className="nv-est__name">
                        {t(`items.${item.id}.name`)}
                        <small>{`${t(`items.${item.id}.group`)} · ${t(`items.${item.id}.desc`)}`}</small>
                      </td>
                      <td className="nv-est__amount">
                        <Money amount={item.estimate} />
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="first">
                    <td className="nv-est__i" />
                    <td>{t("docs.est.parts")}</td>
                    <td className="nv-est__amount">
                      <Money amount={order.partsEstimate} />
                    </td>
                  </tr>
                  <tr>
                    <td className="nv-est__i" />
                    <td>{feeLine}</td>
                    <td className="nv-est__amount">
                      <Money amount={order.fee} />
                    </td>
                  </tr>
                  <tr className="big">
                    <td className="nv-est__i" />
                    <td>{t("docs.est.total")}</td>
                    <td className="nv-est__amount">
                      <Money amount={order.total} />
                    </td>
                  </tr>
                </tfoot>
              </table>
              <div className="pf">
                <span>
                  {t("docs.est.limit", {
                    rate: salePercent(order.reserveRateBp),
                    limit: formatAmount(order.purchaseLimit),
                  })}
                  <br />
                  {t("docs.est.pay", p)}
                </span>
                <Stamp
                  word={t("docs.est.stamp")}
                  meta={t("docs.est.stampMeta")}
                  tilt="left"
                  className="doc-stamp"
                  decorative
                />
              </div>
            </Paper>
          </div>
          <div className="rv" id="docRcpt">
            <Paper badge={sampleBadge} tilt="right">
              <div className="ph">
                <div>
                  <h3>{t("docs.rcpt.heading")}</h3>
                  <div className="pm">{t("docs.rcpt.meta")}</div>
                </div>
                <LogoMark decorative width={30} />
              </div>
              <table className="nv-est">
                <caption className="nv-sr">{t("docs.rcpt.caption")}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t("docs.rcpt.colItem")}</th>
                    <th scope="col" className="nv-est__amount hide-s">
                      {t("docs.rcpt.colEstimate")}
                    </th>
                    <th scope="col" className="nv-est__amount">
                      {t("docs.rcpt.colReceipt")}
                    </th>
                    <th scope="col" className="nv-est__amount">
                      {t("docs.rcpt.colDiff")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {SAMPLE_ITEMS.map((item) => {
                    const diff = item.estimate - item.receipt;
                    return (
                      <tr key={item.id} className="nv-est__row">
                        <td className="nv-est__name">{t(`items.${item.id}.name`)}</td>
                        <td className="nv-est__amount hide-s">
                          <Money amount={item.estimate} />
                        </td>
                        <td className="nv-est__amount">
                          <Money amount={item.receipt} />
                        </td>
                        <td className={`nv-est__amount${diff > 0 ? " minus" : ""}`}>
                          {diff > 0 ? <Money amount={-diff} /> : <Money amount={0} />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="first">
                    <td>{t("docs.rcpt.byEstimate")}</td>
                    <td className="hide-s" />
                    <td className="nv-est__amount" colSpan={2}>
                      <Money amount={order.partsEstimate} />
                    </td>
                  </tr>
                  <tr>
                    <td>{t("docs.rcpt.byReceipts")}</td>
                    <td className="hide-s" />
                    <td className="nv-est__amount" colSpan={2}>
                      <Money amount={order.partsReceipts} />
                    </td>
                  </tr>
                  <tr className="big ret">
                    <td>{t("docs.rcpt.refund")}</td>
                    <td className="hide-s" />
                    <td className="nv-est__amount" colSpan={2}>
                      <Money amount={order.refund} />
                    </td>
                  </tr>
                </tfoot>
              </table>
              <div className="pf">
                <span>
                  {t("docs.rcpt.foot1")}
                  <br />
                  {t("docs.rcpt.foot2", { fee: formatSumsOf(order.fee, locale) })}
                </span>
                <Stamp
                  word={t("docs.rcpt.stamp")}
                  meta={t("docs.rcpt.stampMeta")}
                  tilt="left"
                  className="doc-stamp"
                  decorative
                />
              </div>
            </Paper>
          </div>
        </div>
      </div>
    </section>
  );
}
