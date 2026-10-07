import type { AppLocale } from "@nivel/i18n";
import type { ReactNode } from "react";
import { SiteFooter } from "./SiteFooter.tsx";
import { SiteHeader } from "./SiteHeader.tsx";

/** The header and the footer of every page of the site; the page brings its own `<main>`. */
export async function SiteFrame({
  locale,
  path = "",
  motionOff,
  withMotion,
  children,
}: {
  locale: AppLocale;
  /** Path below the locale, for the language switch of the header. */
  path?: string;
  motionOff: boolean;
  withMotion: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <SiteHeader locale={locale} path={path} />
      {children}
      <SiteFooter locale={locale} motionOff={motionOff} withMotion={withMotion} />
    </>
  );
}
