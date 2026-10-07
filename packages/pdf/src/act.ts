// The acts of the order (ARCHITECTURE 4.9, 6.4): acceptance of the materials of the customer into the work with the prices by the
// receipts (GK art. 661), return of the parts of the customer when the order is cancelled, handover of the finished computer.
// The paper has two signatures and says how the customer signed (the button in Telegram, the photo of the paper act, the site).
import { Text, View } from "@react-pdf/renderer";
import { createElement as h, type ReactElement } from "react";
import { amount, day, money, stampOf } from "./format.ts";
import { DocumentDataError, whole, wholeNonNegative } from "./guards.ts";
import { amountRow, type Cell, paperDocument, paragraph, section, style, table } from "./kit.ts";
import { pdfText, type T } from "./messages.ts";
import { toPdfBuffer } from "./render.ts";
import { assertNoCardNumberDeep } from "./requisites.ts";
import { palette } from "./theme.ts";
import type { ActDoc, ActKind, PdfLang, RenderOptions } from "./types.ts";

/** The kinds of acts, as in sales.acts.kind. */
export const ACT_KINDS = ["material_acceptance", "customer_parts", "handover"] as const satisfies readonly ActKind[];

function assertAct(kind: ActKind, doc: ActDoc): void {
  if (!(ACT_KINDS as readonly string[]).includes(kind))
    throw new DocumentDataError(`the kind of the act is unknown: ${String(kind)}`);
  assertNoCardNumberDeep(doc);
  for (const [i, l] of doc.lines.entries()) {
    whole(`lines.${i}.qty`, l.qty);
    if (l.qty < 1) throw new RangeError(`lines.${i}.qty must be at least 1`);
  }
  for (const [i, r] of (doc.receipts ?? []).entries()) {
    whole(`receipts.${i}.qty`, r.qty);
    wholeNonNegative(`receipts.${i}.amountSum`, r.amountSum);
  }
}

function linesBlock(doc: ActDoc, t: T): ReactElement {
  if (doc.lines.length === 0) return section(t("act.lines.title"), paragraph(t("act.lines.none")));
  const rows: Cell[][] = doc.lines.map((l, i) => [String(i + 1), l.title, String(l.qty), l.serial ?? "—"]);
  return section(
    t("act.lines.title"),
    table(
      [
        { label: "№", flex: 0.4 },
        { label: t("act.col.item"), flex: 4.2 },
        { label: t("act.col.qty"), flex: 0.8, align: "right" },
        { label: t("act.col.serial"), flex: 2.4 },
      ],
      rows,
    ),
  );
}

function receiptsBlock(doc: ActDoc, t: T, lang: PdfLang): ReactElement {
  const receipts = doc.receipts ?? [];
  if (receipts.length === 0) return section(t("act.receipts.title"), paragraph(t("act.receipts.none")));
  const total = receipts.reduce((n, r) => n + r.amountSum, 0);
  return section(
    t("act.receipts.title"),
    table(
      [
        { label: "№", flex: 0.4 },
        { label: t("act.col.item"), flex: 3.2 },
        { label: t("act.col.qty"), flex: 0.8, align: "right" },
        { label: t("act.col.doc"), flex: 2 },
        { label: `${t("act.col.sum")}, ${t("common.sum_unit")}`, flex: 1.8, align: "right" },
      ],
      receipts.map((r, i) => [
        String(i + 1),
        r.title,
        String(r.qty),
        [r.receiptNo, r.boughtAt ? day(r.boughtAt, lang) : null].filter(Boolean).join(" · ") || "—",
        amount(r.amountSum),
      ]),
    ),
    amountRow(t("act.receipts.total"), money(total, lang), { strong: true }),
  );
}

function handoverBlock(doc: ActDoc, t: T, lang: PdfLang): ReactElement {
  return section(
    "",
    paragraph(
      doc.warrantyUntil
        ? t("act.handover.warranty", { date: day(doc.warrantyUntil, lang) })
        : t("act.handover.warranty_pending"),
      style.strong,
    ),
    paragraph(t("act.handover.passport")),
    paragraph(t("act.handover.claims")),
  );
}

function signatureBlock(doc: ActDoc, t: T, lang: PdfLang): ReactElement {
  const ipName = doc.ip?.holder?.trim();
  const side = (label: string, name: string, pending: boolean): ReactElement =>
    h(
      View,
      { style: { flex: 1 }, wrap: false },
      h(Text, { style: style.small }, label),
      h(Text, { style: { ...style.strong, marginTop: 2, color: pending ? palette.stamp : palette.ink } }, name),
      h(View, { style: { height: 26, borderBottomWidth: 0.8, borderBottomColor: palette.asphalt } }),
    );
  return section(
    t("act.sign.title"),
    h(
      View,
      { wrap: false, style: { flexDirection: "row", gap: 28, marginTop: 4 } },
      side(t("act.sign.ip"), ipName || t("common.pending"), !ipName),
      side(t("act.sign.customer"), doc.customerName ?? t("common.unknown_customer"), false),
    ),
    doc.signed
      ? paragraph(
          t("act.sign.signed", { at: stampOf(doc.signed.at, lang), via: t(`act.sign.via.${doc.signed.via}`) }),
          { ...style.strong, marginTop: 8 },
        )
      : paragraph(t("act.sign.unsigned"), { ...style.strong, marginTop: 8, color: palette.stamp }),
  );
}

/** An act in the language of the customer; `options.stub` puts the watermark. */
export async function renderAct(kind: ActKind, doc: ActDoc, options: RenderOptions): Promise<Buffer> {
  assertAct(kind, doc);
  const t = pdfText(options.lang);
  const lang = options.lang;
  const children: (ReactElement | null)[] = [
    paragraph(t(`act.intro.${kind}`), { marginTop: 2 }),
    linesBlock(doc, t),
    kind === "material_acceptance" ? receiptsBlock(doc, t, lang) : null,
    kind === "handover" ? handoverBlock(doc, t, lang) : null,
    signatureBlock(doc, t, lang),
  ];
  return toPdfBuffer(
    paperDocument({
      t,
      options,
      title: t(`act.title.${kind}`),
      number: doc.orderNumber,
      meta: [
        [t("common.customer"), doc.customerName ?? t("common.unknown_customer")],
        [t("common.issued"), day(doc.issuedAt, lang)],
      ],
      children: children.filter((c): c is ReactElement => c !== null),
    }),
  );
}
