import type { AppLocale } from "@nivel/i18n";
import { LogoMark, Mark, RoundStamp } from "@nivel/ui/react";
import { getTranslations } from "next-intl/server";
import { logPath, PASSPORT_SERIES, tempChart } from "../../../../src/i18n/site/temp-series.ts";

const SPECS = [
  { key: "cpu", value: "Ryzen 7 9700X", text: false },
  { key: "gpu", value: "passport.spec.gpuValue", text: true },
  { key: "ram", value: "passport.spec.ramValue", text: true },
  { key: "ssd", value: "passport.spec.ssdValue", text: true },
  { key: "bios", value: "3.20 · 12.08.2026", text: false },
  { key: "profile", value: "EXPO I · 6000 CL30", text: false },
  { key: "psu", value: "passport.spec.psuValue", text: true },
  { key: "room", value: "26 °C", text: false },
] as const;

const TESTS = ["t1", "t2", "t3", "t4", "t5", "t6"] as const;

/** «Build passport»: what is tested and how, with a sample passport of the order NV-0001 (a sample, and it says so). */
export async function Passport({ locale }: { locale: AppLocale }) {
  const t = await getTranslations({ locale, namespace: "site" });
  const cpu = PASSPORT_SERIES[0];
  const maxOf = (id: "cpu" | "gpu") => PASSPORT_SERIES.find((s) => s.id === id)?.max ?? 0;
  return (
    <section className="sec pass" id="pasport">
      <div className="wrap pass-grid">
        <div>
          <p className="kicker">
            <Mark />
            <span>{t("passport.kicker")}</span>
          </p>
          <h2 className="h2">{t("passport.title")}</h2>
          <p className="lead">{t("passport.lead")}</p>
          <ul className="pass-points">
            {(["p1", "p2", "p3"] as const).map((k) => (
              <li key={k}>
                <span>{t(`passport.${k}`)}</span>
              </li>
            ))}
          </ul>
          <figure className="tlog" aria-hidden="true">
            {/* biome-ignore lint/a11y/noSvgWithoutTitle: a decorative curve; its figure is hidden from assistive technology */}
            <svg viewBox="0 0 300 80">
              <line x1="0" x2="300" y1="79.5" y2="79.5" />
              <path d={logPath(cpu?.values ?? [])} pathLength={1} data-tlog-path />
            </svg>
            <figcaption>
              <span>
                <b data-tlog-c>08:00</b> / 08:00
              </span>
              <span>{t("passport.log", { max: maxOf("cpu") })}</span>
            </figcaption>
          </figure>
        </div>
        <article className="nv-paper pp rv" aria-label={t("passport.docLabel")}>
          <div className="sample">{t("docs.sample")}</div>
          <div className="ph">
            <div>
              <h3>{t("passport.docTitle")}</h3>
              <div className="pm">{t("passport.docSub")}</div>
            </div>
            <LogoMark decorative width={30} />
          </div>
          <div className="pmeta">
            <div>
              <span>{t("passport.meta.estimate")}</span>
              <b>05.10.2026</b>
            </div>
            <div>
              <span>{t("passport.meta.tests")}</span>
              <b>09–10.10.2026</b>
            </div>
            <div>
              <span>{t("passport.meta.handover")}</span>
              <b>12.10.2026</b>
            </div>
            <div>
              <span>{t("passport.meta.warranty")}</span>
              <b>12.10.2027</b>
            </div>
          </div>
          <div className="dsec">
            <span>{t("passport.sec1")}</span>
            <span>{t("passport.sec1note")}</span>
          </div>
          <div className="spec">
            {SPECS.map((s) => (
              <div key={s.key}>
                <small>{t(`passport.spec.${s.key}`)}</small>
                <b>{s.text ? t(s.value) : s.value}</b>
              </div>
            ))}
          </div>
          <div className="dsec">
            <span>{t("passport.sec2")}</span>
            <span>{t("passport.sec2note")}</span>
          </div>
          <div className="charts">
            {PASSPORT_SERIES.map((s) => {
              const c = tempChart(s.values, s.peakAt);
              const name = t(`passport.chart.${s.id}`);
              return (
                <div className="chart" key={s.id}>
                  <h4>
                    {`${name}, °C`}
                    <span>{t("passport.chart.max", { max: s.max })}</span>
                  </h4>
                  <svg
                    viewBox={`0 0 ${c.width} ${c.height}`}
                    role="img"
                    aria-label={t("passport.chart.label", { name, max: s.max })}
                  >
                    {c.grid.map((g) => (
                      <g key={g.value}>
                        <line className={g.axis ? "axis" : "grid"} x1={26} x2={292} y1={g.y} y2={g.y} />
                        <text x={g.labelX} y={g.y + 3.5} textAnchor="end">
                          {g.value}
                        </text>
                      </g>
                    ))}
                    {c.hours.map((h) => (
                      <text key={h.hour} x={h.x} y={115} textAnchor="middle">
                        {t("passport.chart.hour", { h: h.hour })}
                      </text>
                    ))}
                    <path className="curve" d={c.path} />
                    <circle className="peak" cx={c.peak.x} cy={c.peak.y} r={4} />
                  </svg>
                </div>
              );
            })}
          </div>
          <table className="nv-est tests">
            <thead>
              <tr>
                <th scope="col">{t("passport.th.test")}</th>
                <th scope="col" className="hide-s">
                  {t("passport.th.duration")}
                </th>
                <th scope="col">{t("passport.th.result")}</th>
                <th scope="col" className="nv-est__amount">
                  {t("passport.th.verdict")}
                </th>
              </tr>
            </thead>
            <tbody>
              {TESTS.map((k) => (
                <tr key={k}>
                  <td>{t(`passport.${k}.name`)}</td>
                  <td className="hide-s nv-num">{t(`passport.${k}.dur`)}</td>
                  <td>
                    {k === "t1"
                      ? t("passport.t1.res", { max: maxOf("cpu") })
                      : k === "t2"
                        ? t("passport.t2.res", { max: maxOf("gpu") })
                        : t(`passport.${k}.res`)}
                  </td>
                  <td className="nv-est__amount">
                    <span className="ok">{t("passport.ok")}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pfoot">
            <div className="sign">
              <div className="line">
                <svg viewBox="0 0 150 30" aria-hidden="true">
                  <path d="M3 22c10-14 16-18 18-10s-6 12 2 6 10-14 14-8-2 10 6 4 8-8 14-6 4 8 12 4 10-6 16-3 14 0 22-4" />
                </svg>
              </div>
              <small>{t("passport.sign")}</small>
            </div>
            <div className="attach">
              <b>{t("passport.attach.title")}</b>
              <span>
                {t("passport.attach.l1")}
                <br />
                {t("passport.attach.l2")}
                <br />
                {t("passport.attach.l3")}
              </span>
            </div>
            <RoundStamp
              id="rs"
              ring={t("passport.stamp.ring")}
              date="10.10.2026"
              label={t("passport.stamp.label")}
              className="rstamp"
            />
          </div>
        </article>
      </div>
    </section>
  );
}
