import type { AppLocale } from "@nivel/i18n";
import { Badge, LogoMark, Mark, Paper, Stamp, Tag } from "@nivel/ui/react";
import { getTranslations } from "next-intl/server";
import { feeChart } from "../../../../src/i18n/site/fee-chart.ts";
import { type FeeScale, mountFee, pcFee } from "../../../../src/i18n/site/fee-scale.ts";
import { formatMln } from "../../../../src/i18n/site/format.ts";
import { priceParams } from "../../../../src/i18n/site/params.ts";

const MLN = 1_000_000;

function Chart({
  scale,
  narrow,
  aria,
  axisX,
  axisY,
  minText,
  lowRate,
  highRate,
}: {
  scale: FeeScale;
  narrow: boolean;
  aria: string;
  axisX: string;
  axisY: string;
  minText: string;
  lowRate: string;
  highRate: string;
}) {
  const c = feeChart(scale, narrow);
  return (
    <svg
      className={narrow ? "fc fc-narrow" : "fc fc-wide"}
      viewBox={`0 0 ${c.width} ${c.height}`}
      role="img"
      aria-label={aria}
    >
      <rect className="fc-band" x={c.band.x} y={c.band.y} width={c.band.width} height={c.band.height} />
      {c.yTicks.map((tick, i) => (
        <g key={tick.label}>
          <line
            className={i === 0 ? "fc-axis" : "fc-grid"}
            x1={c.plot.left}
            x2={c.width - c.plot.right}
            y1={tick.y}
            y2={tick.y}
          />
          <text className="fc-t" x={c.plot.left - 8} y={tick.y + 4} textAnchor="end">
            {tick.label}
          </text>
        </g>
      ))}
      {c.xTicks.map((tick) => (
        <text key={tick.label} className="fc-t" x={tick.x} y={c.height - 14} textAnchor="middle">
          {tick.label}
        </text>
      ))}
      <text className="fc-t" x={c.width - c.plot.right} y={c.height - 1} textAnchor="end">
        {axisX}
      </text>
      <text className="fc-t" x={narrow ? 2 : c.plot.left - 36} y={c.plot.top - 8}>
        {axisY}
      </text>
      <text className="fc-t" x={c.minLabel.x} y={c.minLabel.y} textAnchor="middle">
        {minText}
      </text>
      <path className="fc-line" d={c.path} strokeWidth={2} strokeLinejoin="round" />
      {c.dots.map((d) => (
        <circle key={d.base} className="fc-dot" cx={d.x} cy={d.y} r={4.5} strokeWidth={2} />
      ))}
      <text className="fc-l" x={c.lowLabel.x} y={c.lowLabel.y}>
        {lowRate}
      </text>
      <text className="fc-l" x={c.highLabel.x} y={c.highLabel.y}>
        {highRate}
      </text>
    </svg>
  );
}

/** «Prices and warranty»: the scale of the fee with its date, the chart, the money rules, the sample warranty, and what is returned. */
export async function Prices({ locale, scale }: { locale: AppLocale; scale: FeeScale }) {
  const t = await getTranslations({ locale, namespace: "site" });
  const p = priceParams(scale, locale);
  const lowBase = scale.pcThreshold > 15 * MLN ? 15 * MLN : Math.floor(scale.pcThreshold / 2);
  const highBase = 40 * MLN;
  const mountBase = 7_500_000;
  const example = (base: number, fee: number) =>
    t("prices.example", { base: formatMln(base, locale), fee: formatMln(fee, locale) });
  const chartProps = {
    scale,
    aria: t("prices.chart.aria", p),
    axisX: t("prices.chart.axisX"),
    axisY: t("prices.chart.axisY"),
    minText: t("prices.chart.min", p),
    lowRate: p.lowRate,
    highRate: p.highRate,
  };
  return (
    <section className="sec prices" id="ceny">
      <div className="wrap">
        <div className="sec-head">
          <div>
            <p className="kicker">
              <Mark />
              <span>{t("prices.kicker")}</span>
            </p>
            <h2 className="h2">{t("prices.title")}</h2>
            <p className="lead">{t("prices.lead")}</p>
          </div>
          <Tag>{t("prices.tag", p)}</Tag>
        </div>
        <div className="price-grid">
          <div>
            <table className="scale-t rv">
              <thead>
                <tr>
                  <th>{t("prices.th.size")}</th>
                  <th>{t("prices.th.rate")}</th>
                  <th>{t("prices.th.example")}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    {t("prices.r1.label", p)}
                    <small>{t("prices.r1.note")}</small>
                  </td>
                  <td className="rate">{p.lowRate}</td>
                  <td>
                    <span className="nv-num">{example(lowBase, pcFee(lowBase, scale))}</span>
                  </td>
                </tr>
                <tr>
                  <td>
                    {t("prices.r2.label", p)}
                    <small>{t("prices.r2.note", p)}</small>
                  </td>
                  <td className="rate">
                    {p.highRate}
                    <small>{t("prices.r2.min", p)}</small>
                  </td>
                  <td>
                    <span className="nv-num">{example(highBase, pcFee(highBase, scale))}</span>
                  </td>
                </tr>
                <tr>
                  <td>
                    {t("prices.r3.label")}
                    <small>{t("prices.r3.note")}</small>
                  </td>
                  <td className="rate">{p.mountRate}</td>
                  <td>
                    <span className="nv-num">{example(mountBase, mountFee(mountBase, scale))}</span>
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="fee-chart rv">
              <h3>{t("prices.chart.title", p)}</h3>
              <p>{t("prices.chart.text", p)}</p>
              <Chart {...chartProps} narrow={false} />
              <Chart {...chartProps} narrow />
            </div>
          </div>
          <div className="facts rv">
            <div className="fact">
              <h3>{t("prices.f1.title")}</h3>
              <p>{t("prices.f1.text", p)}</p>
              <a className="to-doc" href="#docRcpt">
                {t("prices.f1.link", p)}
              </a>
            </div>
            <div className="fact">
              <h3>{t("prices.f2.title")}</h3>
              <p>{t("prices.f2.text", p)}</p>
            </div>
            <div className="fact">
              <h3>{t("prices.f3.title")}</h3>
              <p>{t("prices.f3.text", p)}</p>
            </div>
          </div>
        </div>

        <div className="gdoc-wrap rv" id="garantiya">
          <Paper badge={<Badge kind="sample" label={t("docs.sample")} />}>
            <div className="ph">
              <div>
                <h3>{t("guarantee.title")}</h3>
                <div className="pm">{t("guarantee.meta")}</div>
              </div>
              <LogoMark decorative width={30} />
            </div>
            <ol className="gdoc-list">
              {(["g1", "g2", "g3", "g4"] as const).map((k) => (
                <li key={k}>
                  <b>{t(`guarantee.${k}.title`)}</b>
                  <span>{t(`guarantee.${k}.text`)}</span>
                </li>
              ))}
            </ol>
            <div className="pf">
              <span>
                {t("guarantee.foot1")}
                <br />
                {t("guarantee.foot2")}
              </span>
              <Stamp
                word={t("guarantee.stamp")}
                meta={t("guarantee.stampMeta")}
                tilt="left"
                className="doc-stamp"
                decorative
              />
            </div>
          </Paper>
        </div>

        <div className="returns rv" id="vozvrat">
          <p className="kicker">
            <Mark />
            <span>{t("returns.kicker")}</span>
          </p>
          <h3 className="h3">{t("returns.title")}</h3>
          <p className="lead">{t("returns.lead")}</p>
          <div className="facts">
            {(["r1", "r2", "r3"] as const).map((k) => (
              <div className="fact" key={k}>
                <h3>{t(`returns.${k}.title`)}</h3>
                <p>{t(`returns.${k}.text`, p)}</p>
              </div>
            ))}
          </div>
          <a className="to-doc" href={`/${locale}/legal/returns`}>
            {t("returns.link")}
          </a>
        </div>
      </div>
    </section>
  );
}
