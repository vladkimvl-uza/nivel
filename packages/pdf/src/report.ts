// The report of the commission agent (the sole proprietor buys the parts for the customer with the customer's money). The content
// follows item 28 of the Regulation on invoices (Cabinet resolution No. 489; docs/research/25, 3.2): 1 the parties and the
// contract, 2 the table of the purchases (name, serial number, shop and its INN, date, receipt or invoice, price, VAT when it
// is shown, warranty of the shop), 3 discounts, bonuses and cashback (to the customer, GK art. 834 part 2), 4 the money:
// received, spent, returned by the shops, the remainder and the day of its return, 5 the fee in two lines and how it was paid,
// 6 the attachments, 7 the confirmation of the customer with the term of the objections (three working days).
import { Text, View } from "@react-pdf/renderer";
import { createElement as h, type ReactElement } from "react";
import { amount, day, money, stampOf } from "./format.ts";
import { same, whole, wholeNonNegative } from "./guards.ts";
import {
  amountRow,
  type Cell,
  keep,
  keyValue,
  num,
  paperDocument,
  paragraph,
  section,
  style,
  table,
  tag,
  withNotes,
} from "./kit.ts";
import { pdfText, type T } from "./messages.ts";
import { toPdfBuffer } from "./render.ts";
import { assertNoCardNumberDeep } from "./requisites.ts";
import { palette } from "./theme.ts";
import type { CommissionReportDoc, FeePaymentDoc, PdfLang, RenderOptions, ReportLineDoc } from "./types.ts";

function assertReport(doc: CommissionReportDoc): void {
  assertNoCardNumberDeep(doc);
  whole("reportVersion", doc.reportVersion);
  for (const k of ["receivedSum", "spentSum", "discountsSum", "remainderSum", "refundsSum"] as const) {
    whole(k, doc[k]);
  }
  for (const [i, l] of doc.lines.entries()) {
    whole(`lines.${i}.qty`, l.qty);
    whole(`lines.${i}.amountSum`, l.amountSum);
    wholeNonNegative(`lines.${i}.discountSum`, l.discountSum);
    wholeNonNegative(`lines.${i}.files`, l.files);
    if (l.qty < 1) throw new RangeError(`lines.${i}.qty must be at least 1`);
    if (l.isReturn !== l.amountSum < 0)
      throw new RangeError(`lines.${i}: a return has a negative sum, a purchase a positive one`);
  }
  // The same rules the database holds (commission_reports_sums_chk) and the report is made from one snapshot of the purchases.
  same("remainder is not received - spent", doc.receivedSum - doc.spentSum, doc.remainderSum);
  same(
    "the purchases do not add up to the spent sum",
    doc.lines.reduce((n, l) => n + l.amountSum, 0),
    doc.spentSum,
  );
  same(
    "the discounts of the lines are not the discounts of the report",
    doc.lines.filter((l) => !l.isReturn).reduce((n, l) => n + l.discountSum, 0),
    doc.discountsSum,
  );
  same(
    "the returns of the lines are not the returns of the report",
    doc.lines.filter((l) => l.isReturn).reduce((n, l) => n - l.amountSum, 0),
    doc.refundsSum,
  );
  if (doc.fee) {
    for (const k of ["commissionLine", "worksLine", "total"] as const) wholeNonNegative(`fee.${k}`, doc.fee[k]);
    same("the two lines of the fee are not the fee", doc.fee.commissionLine + doc.fee.worksLine, doc.fee.total);
  }
  for (const [i, p] of doc.feePayments.entries()) wholeNonNegative(`feePayments.${i}.sum`, p.sum);
}

function receiptText(l: ReportLineDoc, t: T): string {
  if (l.receiptKind === "none_with_consent") return t("report.item.no_receipt");
  if (l.receiptKind === "esf") return t("report.item.esf", { no: l.esfNo ?? "—" });
  return t("report.item.fiscal", { no: l.receiptNo ?? "—" });
}

function warrantyText(l: ReportLineDoc, t: T, lang: PdfLang): string[] {
  const out: string[] = [];
  if (l.vendorWarrantyMonths) out.push(t("report.item.warranty_months", { months: l.vendorWarrantyMonths }));
  if (l.vendorWarrantyUntil) out.push(t("report.item.warranty_until", { date: day(l.vendorWarrantyUntil, lang) }));
  return out.length > 0 ? out : ["—"];
}

function itemsTable(doc: CommissionReportDoc, t: T, lang: PdfLang): ReactElement {
  const rows: Cell[][] = doc.lines.map((l, i) => {
    const notes = [
      ...l.serials.map((s) => t("report.item.serial", { serial: s })),
      ...(l.files > 0 ? [t("report.item.files", { n: l.files })] : []),
    ];
    const name = h(
      View,
      null,
      withNotes(l.title, notes),
      l.isReturn ? h(View, { style: { marginTop: 2 } }, tag(t("report.item.return"))) : null,
    );
    const shop = withNotes(l.vendor ?? "—", [
      ...(l.vendorInn ? [t("report.item.inn", { inn: l.vendorInn })] : []),
      day(l.boughtAt, lang),
    ]);
    const sum = h(
      View,
      { style: { alignItems: "flex-end" } },
      num(amount(l.amountSum), l.amountSum < 0 ? { color: palette.minus } : {}),
      l.vatSum ? h(Text, { style: style.small }, t("report.item.vat", { sum: amount(l.vatSum) })) : null,
    );
    return [
      String(i + 1),
      name,
      shop,
      h(Text, { style: style.small }, receiptText(l, t)),
      String(l.qty),
      sum,
      h(View, null, ...warrantyText(l, t, lang).map((w, k) => h(Text, { key: k, style: style.small }, w))),
    ];
  });
  return table(
    [
      { label: "№", flex: 0.35 },
      { label: t("report.col.item"), flex: 3.1 },
      { label: t("report.col.shop"), flex: 2 },
      { label: t("report.col.doc"), flex: 2 },
      { label: t("report.col.qty"), flex: 0.65, align: "right" },
      { label: `${t("report.col.sum")}, ${t("common.sum_unit")}`, flex: 1.55, align: "right" },
      { label: t("report.col.warranty"), flex: 1.45 },
    ],
    rows,
    doc.lines.length === 0 ? undefined : ["", t("report.money.spent"), "", "", "", amount(doc.spentSum), ""],
  );
}

function paymentRow(
  kind: FeePaymentDoc["kind"],
  payments: readonly FeePaymentDoc[],
  t: T,
  lang: PdfLang,
): ReactElement {
  const p = payments.find((x) => x.kind === kind);
  const stage = kind === "fee_advance" ? "advance" : "final";
  if (p?.receiptNo) return amountRow(t(`report.fee.${stage}`, { no: p.receiptNo }), money(p.sum, lang));
  return amountRow(t(`report.fee.unpaid_${stage}`), p ? money(p.sum, lang) : "—");
}

function body(doc: CommissionReportDoc, t: T, lang: PdfLang): ReactElement[] {
  const out: ReactElement[] = [];
  const ipName = doc.ip?.holder?.trim() || t("common.pending");
  const ipInn = doc.ip?.inn?.trim() || t("common.pending");
  out.push(h(Text, { style: { ...style.small, marginTop: 2 } }, t("report.basis")));

  out.push(
    section(
      t("report.parties.title"),
      keyValue(t("report.parties.commissioner"), `${ipName}, ${t("report.parties.status")}`, {
        pending: !doc.ip?.holder?.trim(),
      }),
      keyValue(t("requisites.inn"), ipInn, { pending: !doc.ip?.inn?.trim(), mono: !!doc.ip?.inn?.trim() }),
      keyValue(t("common.customer"), doc.customerName ?? t("common.unknown_customer")),
      keyValue(t("report.parties.contract"), doc.orderNumber, { mono: true }),
      doc.quoteVersion ? keyValue(t("report.parties.quote"), String(doc.quoteVersion), { mono: true }) : null,
    ),
  );

  out.push(
    section(
      t("report.items.title"),
      doc.lines.length === 0 ? paragraph(t("report.item.none")) : itemsTable(doc, t, lang),
    ),
  );

  const bonuses = doc.lines.filter((l) => l.bonusNote);
  out.push(
    section(
      t("report.discounts.title"),
      paragraph(t("report.discounts.body")),
      doc.discountsSum > 0 || bonuses.length > 0
        ? amountRow(t("report.discounts.sum"), money(doc.discountsSum, lang))
        : paragraph(t("report.discounts.none")),
      ...bonuses.map((l, i) =>
        h(
          Text,
          { key: i, style: { ...style.small, marginTop: 2 } },
          t("report.discounts.bonus", { title: l.title, note: l.bonusNote as string }),
        ),
      ),
    ),
  );

  out.push(
    section(
      t("report.money.title"),
      amountRow(t("report.money.received"), money(doc.receivedSum, lang)),
      amountRow(t("report.money.spent"), money(doc.spentSum, lang)),
      amountRow(t("report.money.refunds"), money(doc.refundsSum, lang)),
      doc.purchaseLimit == null ? null : amountRow(t("report.money.limit"), money(doc.purchaseLimit, lang)),
      amountRow(t("report.money.remainder"), money(doc.remainderSum, lang), {
        strong: true,
        ...(doc.refundDueAt ? { note: t("report.money.refund_due", { date: day(doc.refundDueAt, lang) }) } : {}),
      }),
    ),
  );

  out.push(
    section(
      t("report.fee.title"),
      keep(
        doc.fee ? amountRow(t("quote.fee.commission"), money(doc.fee.commissionLine, lang)) : null,
        doc.fee ? amountRow(t("quote.fee.works"), money(doc.fee.worksLine, lang)) : null,
        doc.fee ? amountRow(t("quote.fee.total"), money(doc.fee.total, lang), { strong: true }) : null,
        paymentRow("fee_advance", doc.feePayments, t, lang),
        paymentRow("fee_final", doc.feePayments, t, lang),
        h(Text, { style: { ...style.small, marginTop: 3 } }, t("report.fee.no_vat")),
      ),
    ),
  );

  out.push(
    section(
      t("report.attachments.title"),
      paragraph(t("report.attachments.body", { n: doc.lines.reduce((n, l) => n + l.files, 0) })),
    ),
  );

  out.push(
    section(
      t("report.confirm.title"),
      paragraph(
        doc.objectionUntil
          ? t("report.confirm.body", { until: stampOf(doc.objectionUntil, lang) })
          : t("report.confirm.body_no_date"),
      ),
      doc.acceptedAt
        ? paragraph(t("report.confirm.accepted", { date: day(doc.acceptedAt, lang) }), style.strong)
        : null,
      doc.deemedAcceptedAt
        ? paragraph(t("report.confirm.deemed", { date: day(doc.deemedAcceptedAt, lang) }), style.strong)
        : null,
    ),
  );
  return out;
}

/** The report in the language of the customer; `options.stub` puts the watermark. */
export async function renderCommissionReport(doc: CommissionReportDoc, options: RenderOptions): Promise<Buffer> {
  assertReport(doc);
  const t = pdfText(options.lang);
  const meta: [string, string][] = [
    [t("common.customer"), doc.customerName ?? t("common.unknown_customer")],
    [t("common.issued"), day(doc.issuedAt, options.lang)],
    ...(doc.sentAt ? [[t("report.meta.sent"), stampOf(doc.sentAt, options.lang)] as [string, string]] : []),
  ];
  return toPdfBuffer(
    paperDocument({
      t,
      options,
      title: t("report.title"),
      number: doc.orderNumber,
      subtitle: t("common.version", { version: doc.reportVersion }),
      meta,
      children: body(doc, t, options.lang),
    }),
  );
}
