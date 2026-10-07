// The consent text of the page, read the way the page reads it: `content.legal_documents` (cached, tag `legal`), else the text
// built into the site. The wiring to the database is in apps/web/app/[locale]/(marketing)/_data/server.ts.
import { getLegalRows } from "../../app/[locale]/(marketing)/_data/server.ts";
import { resolveLegal, todayInTashkent } from "../i18n/site/data.ts";
import { type ConsentRef, consentRefOf } from "./consent-doc.ts";

export async function consentFromDatabase(lang: "uz" | "ru"): Promise<ConsentRef> {
  const rows = await getLegalRows("consent_pd");
  return consentRefOf(resolveLegal(rows, "consent_pd", lang, todayInTashkent()), lang);
}
