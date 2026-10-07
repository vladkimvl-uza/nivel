// The passport of the build (ARCHITECTURE 6.4, DESIGN_SYSTEM 3.7): the four dates, the parts with serial numbers, the BIOS and the
// operating system, the protocol of the tests, the photos attached, the code of the sticker, the QR code, the stamp "test
// passed" and the line of the master. The tests are those the master wrote in the admin panel (build_passports.tests).
import { Text, View } from "@react-pdf/renderer";
import { createElement as h, type ReactElement } from "react";
import { day } from "./format.ts";
import { whole, wholeNonNegative } from "./guards.ts";
import { type Cell, keyValue, paperDocument, paragraph, section, stamp, style, table } from "./kit.ts";
import { pdfText, type T } from "./messages.ts";
import { qrCode } from "./qr.ts";
import { toPdfBuffer } from "./render.ts";
import { assertNoCardNumberDeep } from "./requisites.ts";
import { palette } from "./theme.ts";
import type { PassportDoc, PdfLang, RenderOptions } from "./types.ts";

function assertPassport(doc: PassportDoc): void {
  assertNoCardNumberDeep(doc);
  wholeNonNegative("photos", doc.photos);
  wholeNonNegative("sealPhotos", doc.sealPhotos);
  if (doc.tests) {
    if (doc.tests.minutes != null) wholeNonNegative("tests.minutes", doc.tests.minutes);
    if (doc.tests.peakTempC != null) whole("tests.peakTempC", doc.tests.peakTempC);
  }
}

function datesRow(doc: PassportDoc, t: T, lang: PdfLang): ReactElement {
  const cell = (label: string, value: string | null | undefined): ReactElement =>
    h(
      View,
      { style: { flex: 1, borderTopWidth: 1.2, borderTopColor: palette.asphalt, paddingTop: 3 } },
      h(Text, { style: style.caption }, label),
      h(Text, { style: { ...style.mono, fontSize: 9.5, marginTop: 2 } }, value ? day(value, lang) : "—"),
    );
  return section(
    t("passport.dates.title"),
    h(
      View,
      { wrap: false, style: { flexDirection: "row", gap: 10 } },
      cell(t("passport.dates.estimate"), doc.dates.estimateAt),
      cell(t("passport.dates.tests"), doc.dates.testsAt),
      cell(t("passport.dates.act"), doc.dates.actAt),
      cell(t("passport.dates.warranty"), doc.dates.warrantyUntil),
    ),
  );
}

function specBlock(doc: PassportDoc, t: T): ReactElement {
  if (doc.serials.length === 0) return section(t("passport.spec.title"), paragraph(t("passport.spec.empty")));
  const rows: Cell[][] = doc.serials.map((s) => [s.label, s.value]);
  return section(
    t("passport.spec.title"),
    table(
      [
        { label: t("act.col.item"), flex: 3 },
        { label: t("act.col.serial"), flex: 3 },
      ],
      rows,
    ),
    doc.biosVersion ? keyValue(t("passport.bios"), doc.biosVersion, { mono: true }) : null,
    doc.os ? keyValue(t("passport.os"), doc.os) : null,
  );
}

function testsBlock(doc: PassportDoc, t: T): ReactElement {
  const tests = doc.tests;
  if (!tests) return section(t("passport.tests.title"), paragraph(t("passport.tests.none")));
  const minutes = tests.minutes;
  return section(
    t("passport.tests.title"),
    tests.tool ? keyValue(t("passport.tests.tool"), tests.tool) : null,
    tests.scenario ? keyValue(t("passport.tests.scenario"), tests.scenario) : null,
    minutes == null
      ? null
      : keyValue(
          t("passport.tests.duration"),
          t("passport.tests.duration_value", { hours: Math.floor(minutes / 60), minutes: minutes % 60 }),
        ),
    tests.peakTempC == null
      ? null
      : keyValue(t("passport.tests.peak"), t("passport.tests.peak_value", { temp: tests.peakTempC }), { mono: true }),
    keyValue(
      t("passport.tests.errors"),
      tests.errors.length === 0
        ? t("passport.tests.errors_none")
        : t("passport.tests.errors_count", { n: tests.errors.length }),
    ),
    ...tests.errors.map((e, i) => h(Text, { key: i, style: { ...style.small, marginLeft: 100, marginTop: 1 } }, e)),
  );
}

/** The passport in the language of the customer; `options.stub` puts the watermark. */
export async function renderPassport(doc: PassportDoc, options: RenderOptions): Promise<Buffer> {
  assertPassport(doc);
  const t = pdfText(options.lang);
  const lang = options.lang;
  const passed = doc.tests != null && doc.tests.errors.length === 0;
  const stampDate = doc.dates.testsAt ?? doc.issuedAt;
  const footer = h(
    View,
    {
      wrap: false,
      style: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 16 },
    },
    h(
      View,
      { style: { width: 150 } },
      doc.qr ? qrCode(doc.qr) : null,
      doc.qr ? h(Text, { style: { ...style.small, marginTop: 2 } }, t("passport.qr")) : null,
    ),
    passed ? stamp(t("passport.stamp.word"), `${day(stampDate, lang)} · ${doc.orderNumber}`) : h(View, null),
    h(
      View,
      { style: { width: 170 } },
      h(View, { style: { height: 28, borderBottomWidth: 0.8, borderBottomColor: palette.asphalt } }),
      h(Text, { style: { ...style.small, marginTop: 2 } }, t("passport.master")),
    ),
  );
  return toPdfBuffer(
    paperDocument({
      t,
      options,
      title: t("passport.title"),
      number: doc.orderNumber,
      meta: [
        [t("common.customer"), doc.customerName ?? t("common.unknown_customer")],
        [t("common.issued"), day(doc.issuedAt, lang)],
      ],
      children: [
        datesRow(doc, t, lang),
        specBlock(doc, t),
        testsBlock(doc, t),
        paragraph(t("passport.attachments", { photos: doc.photos, seals: doc.sealPhotos }), {
          ...style.small,
          marginTop: 8,
        }),
        doc.labelCode ? keyValue(t("passport.label"), doc.labelCode, { mono: true }) : null,
        doc.notes ? keyValue(t("passport.notes"), doc.notes) : null,
        footer,
      ].filter((c): c is ReactElement => c !== null),
    }),
  );
}
