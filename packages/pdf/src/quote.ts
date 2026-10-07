// The estimate (smeta): lines with the date of the price, the totals of the domain, the fee in two lines and in two stages,
// the limit of the purchase, the lines without return under their own heading, the account of the sole proprietor with the
// purpose of the payment. ARCHITECTURE 6.4; DESIGN_SYSTEM 3.7 (the estimate with stamps).
import { Text, View } from "@react-pdf/renderer";
import { createElement as h, type ReactElement } from "react";
import { amount, day, money, rate, stampOf } from "./format.ts";
import { same, whole, wholeNonNegative } from "./guards.ts";
import { amountRow, band, type Cell, paperDocument, paragraph, section, stamp, style, table, tag } from "./kit.ts";
import { pdfText, type T } from "./messages.ts";
import { toPdfBuffer } from "./render.ts";
import { assertNoCardNumberDeep, requisitesBlock } from "./requisites.ts";
import type { PdfLang, QuoteDoc, QuoteLineDoc, RenderOptions } from "./types.ts";

/** What the database checks about an estimate, checked again before it is printed. */
function assertQuote(doc: QuoteDoc): void {
  assertNoCardNumberDeep(doc);
  whole("version", doc.version);
  for (const [i, l] of doc.lines.entries()) {
    whole(`lines.${i}.qty`, l.qty);
    wholeNonNegative(`lines.${i}.unitSum`, l.unitSum);
    if (l.qty < 1) throw new RangeError(`lines.${i}.qty must be at least 1`);
  }
  const t = doc.totals;
  for (const [k, v] of Object.entries(t)) if (typeof v === "number") wholeNonNegative(`totals.${k}`, v);
  for (const [i, p] of t.feeParts.entries()) {
    wholeNonNegative(`totals.feeParts.${i}.base`, p.base);
    wholeNonNegative(`totals.feeParts.${i}.rateBp`, p.rateBp);
    wholeNonNegative(`totals.feeParts.${i}.amount`, p.amount);
  }
  same("advance + final is not the fee", t.advance + t.final, t.feeTotal);
  same("the two lines of the fee are not the fee", t.feeCommissionLine + t.feeWorksLine, t.feeTotal);
  same("limit + fee is not the grand total", t.purchaseLimit + t.feeTotal, t.grandTotal);
}

const GROUPS = ["pc", "mount", "outside_scale"] as const;

function itemCell(line: QuoteLineDoc, t: T, lang: PdfLang): ReactElement {
  const notes: string[] = [];
  const first = [
    line.priceDate ? t("quote.line.price_date", { date: day(line.priceDate, lang) }) : null,
    line.confidence ? t(`quote.line.confidence.${line.confidence}`) : null,
    line.vendorHint ? t("quote.line.vendor", { name: line.vendorHint }) : null,
  ].filter((x): x is string => x !== null);
  if (first.length > 0) notes.push(first.join(" · "));
  if (!line.customerOwned && line.returnable === "unknown") notes.push(t("quote.line.return_unknown"));
  return h(
    View,
    null,
    h(Text, { style: style.strong }, line.title),
    ...notes.map((n, i) => h(Text, { key: i, style: style.small }, n)),
    !line.customerOwned && line.returnable === "no"
      ? h(View, { style: { marginTop: 2 } }, tag(t("quote.line.no_return")))
      : null,
  );
}

function linesTable(
  heading: string,
  lines: readonly QuoteLineDoc[],
  from: number,
  t: T,
  lang: PdfLang,
  owned: boolean,
): ReactElement {
  const unit = `, ${t("common.sum_unit")}`;
  const rows: Cell[][] = lines.map((l, i) => [
    String(from + i),
    itemCell(l, t, lang),
    String(l.qty),
    owned ? "—" : amount(l.unitSum),
    owned ? "—" : amount(l.qty * l.unitSum),
  ]);
  return section(
    heading,
    table(
      [
        { label: t("quote.col.n"), flex: 0.4 },
        { label: t("quote.col.item"), flex: 4.4 },
        { label: t("quote.col.qty"), flex: 0.8, align: "right" },
        { label: `${t("quote.col.price")}${unit}`, flex: 1.6, align: "right" },
        { label: `${t("quote.col.sum")}${unit}`, flex: 1.8, align: "right" },
      ],
      rows,
    ),
  );
}

function feeTable(doc: QuoteDoc, t: T): ReactElement | null {
  if (doc.totals.feeParts.length === 0) return null;
  return table(
    [
      { label: "", flex: 3.4 },
      { label: `${t("quote.fee.base")}, ${t("common.sum_unit")}`, flex: 1.8, align: "right" },
      { label: t("quote.fee.rate"), flex: 0.9, align: "right" },
      { label: `${t("quote.fee.amount")}, ${t("common.sum_unit")}`, flex: 1.8, align: "right" },
    ],
    doc.totals.feeParts.map((p) => [t(`quote.fee.rule.${p.rule}`), amount(p.base), rate(p.rateBp), amount(p.amount)]),
  );
}

function body(doc: QuoteDoc, t: T, lang: PdfLang): ReactElement[] {
  const out: ReactElement[] = [];
  const tt = doc.totals;
  const bought = doc.lines.filter((l) => !l.customerOwned);
  let n = 1;
  for (const g of GROUPS) {
    const lines = bought.filter((l) => l.group === g);
    if (lines.length === 0) continue;
    out.push(linesTable(t(`quote.group.${g}`), lines, n, t, lang, false));
    n += lines.length;
  }
  const owned = doc.lines.filter((l) => l.customerOwned);
  if (owned.length > 0) out.push(linesTable(t("quote.group.customer_owned"), owned, n, t, lang, true));

  out.push(
    section(
      t("quote.totals.title"),
      amountRow(t("quote.totals.components"), money(tt.componentsSum, lang)),
      tt.outsideScaleSum > 0 ? amountRow(t("quote.totals.outside"), money(tt.outsideScaleSum, lang)) : null,
      amountRow(t("quote.totals.reserve", { rate: rate(tt.reserveBp) }), money(tt.reserveSum, lang)),
      amountRow(t("quote.totals.limit"), money(tt.purchaseLimit, lang), {
        strong: true,
        note: t("quote.totals.limit_note"),
      }),
    ),
  );
  out.push(
    section(
      t("quote.fee.title"),
      feeTable(doc, t),
      amountRow(t("quote.fee.commission"), money(tt.feeCommissionLine, lang)),
      amountRow(t("quote.fee.works"), money(tt.feeWorksLine, lang)),
      amountRow(t("quote.fee.total"), money(tt.feeTotal, lang), { strong: true }),
    ),
  );
  out.push(
    section(
      t("quote.stages.title"),
      amountRow(t("quote.stages.advance"), money(tt.advance, lang)),
      amountRow(t("quote.stages.final"), money(tt.final, lang)),
    ),
  );
  out.push(band(amountRow(t("quote.total.grand"), money(tt.grandTotal, lang), { strong: true, rule: false })));

  const noReturn = bought.filter((l) => l.returnable === "no");
  if (noReturn.length > 0) {
    out.push(
      section(
        t("quote.nonreturn.title"),
        paragraph(t("quote.nonreturn.body")),
        ...noReturn.map((l, i) => h(Text, { key: i, style: { marginTop: 2 } }, `• ${l.title}`)),
      ),
    );
  }
  out.push(requisitesBlock(doc.requisites, doc.orderNumber, t));
  if (doc.validUntil) {
    out.push(paragraph(t("quote.expiry", { date: stampOf(doc.validUntil, lang) }), { ...style.small, marginTop: 8 }));
  }
  if (doc.checkedAt) {
    out.push(
      h(
        View,
        { style: { marginTop: 10, flexDirection: "row", justifyContent: "flex-end" } },
        stamp(t("quote.stamp_checked"), `${day(doc.checkedAt, lang)} · ${doc.orderNumber}`),
      ),
    );
  }
  return out;
}

/** The estimate in the language of the customer; `options.stub` puts the watermark (the offer is a placeholder). */
export async function renderQuote(doc: QuoteDoc, options: RenderOptions): Promise<Buffer> {
  assertQuote(doc);
  const t = pdfText(options.lang);
  const meta: [string, string][] = [
    [t("common.customer"), doc.customerName ?? t("common.unknown_customer")],
    ...(doc.priceDate ? [[t("quote.price_date"), day(doc.priceDate, options.lang)] as [string, string]] : []),
    ...(doc.validUntil ? [[t("quote.valid_until"), stampOf(doc.validUntil, options.lang)] as [string, string]] : []),
    ...(doc.fx
      ? [
          [
            t("quote.fx"),
            t("quote.fx_value", { ccy: doc.fx.ccy, rate: doc.fx.rate, date: day(doc.fx.date, options.lang) }),
          ] as [string, string],
        ]
      : []),
  ];
  return toPdfBuffer(
    paperDocument({
      t,
      options,
      title: t("quote.title"),
      number: doc.orderNumber,
      subtitle: t("common.version", { version: doc.version }),
      meta,
      children: body(doc, t, options.lang),
    }),
  );
}
