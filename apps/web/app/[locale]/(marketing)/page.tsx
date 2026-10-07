import { isLocale } from "@nivel/i18n";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { buildSiteConfig } from "../../../src/i18n/site/client/config.ts";
import { formatSumsOf } from "../../../src/i18n/site/format.ts";
import { BG_LABEL_KEYS, buildLabels } from "../../../src/i18n/site/labels.ts";
import { mediaBaseOf } from "../../../src/i18n/site/media-url.ts";
import { priceParams } from "../../../src/i18n/site/params.ts";
import { MOTION_COOKIE, readMotionPrefs } from "../../../src/i18n/site/prefs.ts";
import { SAMPLE_ITEMS } from "../../../src/i18n/site/sample-order.ts";
import { pickUtm } from "../../../src/lead-form/utm.ts";
import { Background } from "./_components/Background.tsx";
import { Bands } from "./_components/Bands.tsx";
import { Finale } from "./_components/Finale.tsx";
import { Hero } from "./_components/Hero.tsx";
import { HowWeWork } from "./_components/HowWeWork.tsx";
import { Islands } from "./_components/Islands.tsx";
import { Passport } from "./_components/Passport.tsx";
import { Prices } from "./_components/Prices.tsx";
import { RequestSection } from "./_components/RequestSection.tsx";
import { getFeeScale } from "./_data/server.ts";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  return { alternates: { canonical: `/${locale}` } };
}

/** `/[locale]`: the one-page site of R0: the first screen, how we work, the three scenes of the order, the passport, prices and guarantee, the request, the finale. */
export default async function HomePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const [{ scale }, query, store, h] = await Promise.all([getFeeScale(), searchParams, cookies(), headers()]);
  const prefs = readMotionPrefs(store.get(MOTION_COOKIE)?.value, h.get("save-data"));
  const t = await getTranslations({ locale, namespace: "site" });
  const p = priceParams(scale, locale);
  const mediaBase = mediaBaseOf(process.env);

  // The sums of the receipts that have come, for 0..9 of them, as the background writes them under the receipts.
  const receiptSums = [
    0,
    ...SAMPLE_ITEMS.map((_, i) => SAMPLE_ITEMS.slice(0, i + 1).reduce((a, x) => a + x.receipt, 0)),
  ].map((n) => formatSumsOf(n, locale));
  const config = buildSiteConfig({
    mediaBase,
    locale,
    reduced: prefs.reduced,
    labels: buildLabels(BG_LABEL_KEYS, (key) => String(t.raw(key)), { final: p.final }),
    stepNames: [0, 1, 2, 3].map((i) => t(`hero.steps.s${i}`)),
    stepNow: String(t.raw("hero.stepNow")),
    receiptSums,
    refund: p.refund,
    motion: { on: t("footer.motionOn"), off: t("footer.motionOff") },
  });

  return (
    <>
      <Background locale={locale} grain={config.bg.grain} />
      <main id="top">
        <Hero locale={locale} mediaBase={mediaBase} reduced={prefs.reduced} scale={scale} />
        <HowWeWork locale={locale} scale={scale} />
        <Bands locale={locale} scale={scale} />
        <Passport locale={locale} />
        <Prices locale={locale} scale={scale} />
        <RequestSection locale={locale} utm={pickUtm(query)} />
        <Finale locale={locale} />
      </main>
      <Islands config={config} />
    </>
  );
}
