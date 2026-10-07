// The warranty card (the warranty obligation, DECISIONS R-12): twelve months for the whole system, "one window", the terms of
// the reply, the diagnosis, the loaner and the fix, the refusal only with a causal link and with evidence, the journal of the
// cases. The numbers of the terms are those of `warrantyDeadlines` of the domain; a test holds the text to them.
import { Text, View } from "@react-pdf/renderer";
import { createElement as h, type ReactElement } from "react";
import { day } from "./format.ts";
import { type Cell, paperDocument, paragraph, section, stamp, style, table } from "./kit.ts";
import { pdfText, type T } from "./messages.ts";
import { toPdfBuffer } from "./render.ts";
import { assertNoCardNumberDeep } from "./requisites.ts";
import { CONDENSED, palette } from "./theme.ts";
import type { PdfLang, RenderOptions, WarrantyDoc } from "./types.ts";

const POINTS = [1, 2, 3, 4, 5, 6] as const;

function point(n: number, text: string): ReactElement {
  // The number is a run of the same paragraph (one baseline, the text reads in one piece); a hanging indent would need two boxes,
  // and the baselines of two boxes drift apart when the text wraps.
  return h(
    View,
    {
      wrap: false,
      style: { paddingTop: 4, paddingBottom: 4, borderBottomWidth: 0.5, borderBottomColor: palette.line },
    },
    h(
      Text,
      null,
      h(Text, { style: { fontFamily: CONDENSED, fontWeight: 700, fontSize: 11, color: palette.stamp } }, `${n}   `),
      text,
    ),
  );
}

function itemsBlock(doc: WarrantyDoc, t: T, lang: PdfLang): ReactElement {
  if (doc.items.length === 0) return section(t("warranty.items.title"), paragraph(t("warranty.items.none")));
  const rows: Cell[][] = doc.items.map((i, k) => [
    String(k + 1),
    i.title,
    i.serial ?? "—",
    i.vendorWarrantyUntil ? t("warranty.items.vendor_until", { date: day(i.vendorWarrantyUntil, lang) }) : "—",
  ]);
  return section(
    t("warranty.items.title"),
    table(
      [
        { label: "№", flex: 0.4 },
        { label: t("act.col.item"), flex: 3.2 },
        { label: t("act.col.serial"), flex: 2.4 },
        { label: "", flex: 2.6 },
      ],
      rows,
    ),
  );
}

/** The warranty card in the language of the customer; `options.stub` puts the watermark (the texts are not yet checked by a lawyer). */
export async function renderWarrantyCard(doc: WarrantyDoc, options: RenderOptions): Promise<Buffer> {
  assertNoCardNumberDeep(doc);
  const t = pdfText(options.lang);
  const lang = options.lang;
  const until = doc.warrantyUntil
    ? t("warranty.until", { date: day(doc.warrantyUntil, lang) })
    : t("warranty.until_pending");
  const ipName = doc.ip?.holder?.trim();
  return toPdfBuffer(
    paperDocument({
      t,
      options,
      title: t("warranty.title"),
      number: doc.orderNumber,
      meta: [
        [t("common.customer"), doc.customerName ?? t("common.unknown_customer")],
        [t("common.issued"), day(doc.issuedAt, lang)],
      ],
      children: [
        paragraph(t("warranty.intro", { number: doc.orderNumber }), { marginTop: 2 }),
        section("", ...POINTS.map((n) => point(n, t(`warranty.p${n}`)))),
        h(
          View,
          {
            wrap: false,
            style: { marginTop: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
          },
          stamp(t("warranty.stamp"), until),
          h(
            View,
            { style: { width: 240 } },
            h(Text, { style: style.small }, t("act.sign.ip")),
            h(
              Text,
              { style: { ...style.strong, marginTop: 2, color: ipName ? palette.ink : palette.stamp } },
              ipName || t("common.pending"),
            ),
            h(View, { style: { height: 26, borderBottomWidth: 0.8, borderBottomColor: palette.asphalt } }),
          ),
        ),
        itemsBlock(doc, t, lang),
      ],
    }),
  );
}
