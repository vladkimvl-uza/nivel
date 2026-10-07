import { isLocale } from "@nivel/i18n";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { MOTION_COOKIE, readMotionPrefs } from "../../../src/i18n/site/prefs.ts";
import { SiteFrame } from "./_components/SiteFrame.tsx";

/** The one-page site: the header and the footer around the page; the page brings the sections and the background. */
export default async function MarketingLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const prefs = readMotionPrefs((await cookies()).get(MOTION_COOKIE)?.value, (await headers()).get("save-data"));
  return (
    <SiteFrame locale={locale} motionOff={prefs.motionOff} withMotion>
      {children}
    </SiteFrame>
  );
}
