// Building blocks of the documents on paper (DESIGN_SYSTEM 3.4-3.7): the frame of a page with the mark, the footer and the
// watermark; tables with a heavy line under the header, thin lines between rows and a double line under the total; stamps
// and tags. No JSX: the package has no tsconfig of its own to switch it on, `createElement` does the same.

import { Document, G, Page, Path, Svg, Text, View } from "@react-pdf/renderer";
import { type ComponentProps, createElement as h, type ReactElement, type ReactNode } from "react";
import { logoParts } from "./logo.ts";
import type { T } from "./messages.ts";
import { CONDENSED, MONO, palette, TEXT } from "./theme.ts";
import type { RenderOptions } from "./types.ts";

export type PdfStyle = Exclude<NonNullable<ComponentProps<typeof View>["style"]>, readonly unknown[]>;
type DocumentElement = ReactElement<ComponentProps<typeof Document>>;

const PAGE_PADDING = { top: 34, right: 36, bottom: 58, left: 36 } as const;
const BASE_SIZE = 8.6;
/** A4 in points; the footer is placed from the top because `bottom` is counted from the end of the padding box. */
const A4_HEIGHT = 841.89;
const FOOTER_BOTTOM = 22;
const FOOTER_HEIGHT = 26;

export const style = {
  body: { fontFamily: TEXT, fontWeight: 400, fontSize: BASE_SIZE, color: palette.ink, lineHeight: 1.32 },
  small: { fontFamily: TEXT, fontWeight: 400, fontSize: 7.4, color: palette.ink2, lineHeight: 1.3 },
  strong: { fontFamily: TEXT, fontWeight: 500 },
  mono: { fontFamily: MONO, fontWeight: 400, fontSize: 8.2 },
  caption: {
    fontFamily: MONO,
    fontWeight: 400,
    fontSize: 6.8,
    letterSpacing: 0.5,
    color: palette.ink2,
    textTransform: "uppercase",
  },
} as const satisfies Record<string, PdfStyle>;

/** The sample mark across the page: a stamp-colored text under the content's eyes, light enough not to hide a digit. */
function watermark(t: T): ReactElement {
  return h(
    View,
    {
      fixed: true,
      style: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: "center",
        justifyContent: "center",
      },
    },
    h(
      Text,
      {
        style: {
          fontFamily: CONDENSED,
          fontWeight: 700,
          fontSize: 52,
          width: 440,
          textAlign: "center",
          color: palette.stamp,
          opacity: 0.13,
          transform: "rotate(-32deg)",
        },
      },
      t("common.watermark"),
    ),
  );
}

/** The mark nivel-1 with the word, as vector paths. */
export function logo(width = 92): ReactElement {
  const parts = logoParts();
  return h(
    Svg,
    { viewBox: parts.viewBox, style: { width, height: width / parts.ratio } },
    ...parts.paths.map((p, i) =>
      h(
        G,
        { key: i, ...(p.transforms.length > 0 ? { transform: p.transforms.join(" ") } : {}) },
        h(Path, { d: p.d, fill: p.fill }),
      ),
    ),
  );
}

export interface FrameInput {
  t: T;
  options: RenderOptions;
  /** Name of the document: "Smeta". */
  title: string;
  /** Number of the order, printed under the title and in the footer. */
  number: string;
  /** Rows of the line under the header: label and value (the date of the prices, the term, the customer). */
  meta?: readonly (readonly [string, string])[];
  /** The line under the title: "version 2" or similar. */
  subtitle?: string;
  children: ReactNode;
}

function metaRow(rows: readonly (readonly [string, string])[]): ReactElement {
  return h(
    View,
    { style: { flexDirection: "row", flexWrap: "wrap", marginTop: 7, marginBottom: 2, gap: 14 } },
    ...rows.map(([label, value], i) =>
      h(
        View,
        { key: i, style: { flexDirection: "row", gap: 4, alignItems: "baseline" } },
        h(Text, { style: style.caption }, label),
        h(Text, { style: { ...style.mono, fontSize: 8 } }, value),
      ),
    ),
  );
}

function footer(input: FrameInput): ReactElement {
  const { t, options, number } = input;
  const notices = [
    ...(options.stub ? [t("common.notice_stub")] : []),
    ...(options.demo === true ? [t("common.notice_demo")] : []),
  ];
  const small = { ...style.small, fontSize: 6.8 };
  return h(
    View,
    {
      fixed: true,
      style: {
        position: "absolute",
        left: PAGE_PADDING.left,
        right: PAGE_PADDING.right,
        top: A4_HEIGHT - FOOTER_BOTTOM - FOOTER_HEIGHT,
        borderTopWidth: 0.6,
        borderTopColor: palette.ink2,
        paddingTop: 5,

        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 10,
      },
    },
    h(Text, { style: { ...small, width: 118, flexShrink: 0 } }, t("common.brand")),
    h(
      View,
      { style: { flex: 1 } },
      ...notices.map((n, i) => h(Text, { key: i, style: { ...small, color: palette.stamp } }, n)),
    ),
    h(Text, {
      style: { ...small, fontFamily: MONO, textAlign: "right", width: 110, flexShrink: 0 },
      // The first pass of the layout knows no total yet: the page itself stands in until the second one.
      render: ({ pageNumber, totalPages }: { pageNumber: number; totalPages?: number }) =>
        `${number} · ${t("common.page", { page: pageNumber, total: totalPages ?? pageNumber })}`,
    }),
  );
}

/** A document on paper: A4, the header with the title and the mark, the body, the footer, the watermark when it is a sample. */
export function paperDocument(input: FrameInput): DocumentElement {
  const { t, options, title, number, meta, subtitle } = input;
  const sample = options.stub || options.demo === true;
  const header = h(
    View,
    {
      style: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "flex-start",
        borderBottomWidth: 1.5,
        borderBottomColor: palette.asphalt,
        paddingBottom: 8,
      },
    },
    h(
      View,
      { style: { flex: 1, paddingRight: 12 } },
      h(Text, { style: { fontFamily: CONDENSED, fontWeight: 700, fontSize: 20, lineHeight: 1.1 } }, title),
      h(
        Text,
        { style: { ...style.mono, color: palette.ink2, marginTop: 3 } },
        subtitle === undefined ? number : `${number} · ${subtitle}`,
      ),
    ),
    logo(),
  );
  return h(
    Document,
    {
      title: `${title} ${number}`,
      author: "Nivel",
      creator: "Nivel",
      producer: "Nivel",
      subject: title,
      language: options.lang === "uz" ? "uz-Latn" : "ru",
    },
    h(
      Page,
      {
        size: "A4",
        style: {
          ...style.body,
          backgroundColor: palette.paper,
          paddingTop: PAGE_PADDING.top,
          paddingRight: PAGE_PADDING.right,
          paddingBottom: PAGE_PADDING.bottom,
          paddingLeft: PAGE_PADDING.left,
        },
      },
      header,
      meta !== undefined && meta.length > 0 ? metaRow(meta) : null,
      h(View, { style: { marginTop: 8 } }, ...(Array.isArray(input.children) ? input.children : [input.children])),
      footer(input),
      sample ? watermark(t) : null,
    ),
  );
}

// ---- blocks ----

/** A numbered or plain heading of a section, in the condensed face, with a thin line over it. */
export function section(title: string, ...children: ReactNode[]): ReactElement {
  return h(
    View,
    { style: { marginTop: 11 } },
    h(
      Text,
      {
        style: {
          fontFamily: CONDENSED,
          fontWeight: 600,
          fontSize: 11.5,
          marginBottom: 4,
          color: palette.asphalt,
        },
        minPresenceAhead: 40,
      },
      title,
    ),
    ...children,
  );
}

export interface Column {
  label: string;
  /** Share of the width. */
  flex: number;
  align?: "left" | "right";
}

/** A cell: a text, or any element (a name with notes under it). */
export type Cell = ReactNode;

const cellBox = (col: Column, first = false): PdfStyle => ({
  flex: col.flex,
  paddingLeft: first ? 0 : 4,
  paddingRight: 4,
  alignItems: col.align === "right" ? "flex-end" : "flex-start",
});

/** The text of a number cell: mono, right. */
export function num(text: string, extra: PdfStyle = {}): ReactElement {
  return h(Text, { style: { ...style.mono, textAlign: "right", ...extra } }, text);
}

/** A text with grey notes under it (seller, date of the price, serial numbers). */
export function withNotes(text: string, notes: readonly string[]): ReactElement {
  return h(
    View,
    null,
    h(Text, { style: style.strong }, text),
    ...notes.map((n, i) => h(Text, { key: i, style: style.small }, n)),
  );
}

/**
 * Header with the heavy line, rows with thin lines (a row is never torn between pages), an optional row of totals under a
 * double line.
 */
export function table(
  columns: readonly Column[],
  rows: readonly (readonly Cell[])[],
  foot?: readonly Cell[],
): ReactElement {
  const row = (cells: readonly Cell[], extra: PdfStyle, key?: number): ReactElement =>
    h(
      View,
      { key, wrap: false, style: { flexDirection: "row", ...extra } },
      ...columns.map((col, i) => {
        const cell = cells[i];
        return h(
          View,
          { key: i, style: cellBox(col, i === 0) },
          typeof cell === "string" || typeof cell === "number"
            ? h(Text, { style: col.align === "right" ? { ...style.mono, textAlign: "right" } : {} }, String(cell))
            : (cell ?? null),
        );
      }),
    );
  const head = h(
    View,
    {
      style: {
        flexDirection: "row",
        borderBottomWidth: 1.5,
        borderBottomColor: palette.asphalt,
        paddingBottom: 3,
        marginBottom: 1,
      },
    },
    ...columns.map((col, i) =>
      h(
        View,
        { key: i, style: cellBox(col, i === 0) },
        h(Text, { style: { ...style.caption, textAlign: col.align === "right" ? "right" : "left" } }, col.label),
      ),
    ),
  );
  return h(
    View,
    null,
    head,
    ...rows.map((cells, i) =>
      row(cells, { paddingTop: 3.5, paddingBottom: 3.5, borderBottomWidth: 0.5, borderBottomColor: palette.line }, i),
    ),
    foot === undefined
      ? null
      : h(
          View,
          { wrap: false, style: { marginTop: 2 } },
          // The double line of a total (DESIGN_SYSTEM 3.4): two thin rules, the renderer has no `double` border.
          h(View, { style: { borderTopWidth: 0.8, borderTopColor: palette.asphalt } }),
          h(View, { style: { borderTopWidth: 0.8, borderTopColor: palette.asphalt, marginTop: 1.6 } }),
          row(foot, { paddingTop: 4, paddingBottom: 3 }),
        ),
  );
}

/** A line of label and value, the value on the right in mono (the rows of the totals). */
export function amountRow(
  label: ReactNode,
  value: string,
  opts: { strong?: boolean; negative?: boolean; note?: string; rule?: boolean } = {},
): ReactElement {
  return h(
    View,
    {
      wrap: false,
      style: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "flex-start",
        paddingTop: 3,
        paddingBottom: 3,
        borderBottomWidth: opts.rule === false ? 0 : 0.5,
        borderBottomColor: palette.line,
        gap: 10,
      },
    },
    h(
      View,
      { style: { flex: 1 } },
      typeof label === "string" ? h(Text, { style: opts.strong === true ? style.strong : {} }, label) : label,
      opts.note === undefined ? null : h(Text, { style: style.small }, opts.note),
    ),
    h(
      Text,
      {
        style: {
          ...style.mono,
          fontWeight: opts.strong === true ? 500 : 400,
          textAlign: "right",
          color: opts.negative === true ? palette.minus : palette.ink,
        },
      },
      value,
    ),
  );
}

/** A tag in the mono face with a frame in the ink of the stamp: "example, not an offer", "no return". */
export function tag(text: string): ReactElement {
  return h(
    Text,
    {
      style: {
        ...style.mono,
        fontSize: 6.8,
        color: palette.stamp,
        borderWidth: 0.7,
        borderColor: palette.stamp,
        paddingTop: 1,
        paddingBottom: 1,
        paddingLeft: 3,
        paddingRight: 3,
        alignSelf: "flex-start",
      },
    },
    text,
  );
}

/** A rectangular double stamp: a word in the condensed face and a line of date and number in mono; slightly turned. */
export function stamp(word: string, line: string): ReactElement {
  return h(
    View,
    {
      wrap: false,
      style: {
        alignSelf: "flex-start",
        transform: "rotate(-3deg)",
        borderWidth: 1.6,
        borderColor: palette.stamp,
        padding: 2,
      },
    },
    h(
      View,
      {
        style: {
          borderWidth: 0.6,
          borderColor: palette.stamp,
          paddingTop: 3,
          paddingBottom: 3,
          paddingLeft: 9,
          paddingRight: 9,
        },
      },
      h(
        Text,
        {
          style: {
            fontFamily: CONDENSED,
            fontWeight: 700,
            fontSize: 14,
            lineHeight: 1,
            color: palette.stamp,
            textTransform: "uppercase",
            letterSpacing: 0.6,
          },
        },
        word,
      ),
      h(Text, { style: { ...style.mono, fontSize: 7, lineHeight: 1.2, marginTop: 2, color: palette.stamp } }, line),
    ),
  );
}

/** The block with the requisites of the account: label and value, the placeholder in the ink of the stamp. */
export function keyValue(label: string, value: string, opts: { pending?: boolean; mono?: boolean } = {}): ReactElement {
  return h(
    View,
    { wrap: false, style: { flexDirection: "row", paddingTop: 2, paddingBottom: 2, gap: 8 } },
    h(Text, { style: { ...style.small, width: 92 } }, label),
    h(
      Text,
      {
        style: {
          flex: 1,
          ...(opts.mono === true ? style.mono : style.strong),
          color: opts.pending === true ? palette.stamp : palette.ink,
        },
      },
      value,
    ),
  );
}

/** A box with the band of paper under it (the block of the requisites, the note of the total). */
export function band(...children: ReactNode[]): ReactElement {
  return h(View, { wrap: false, style: { backgroundColor: palette.band, padding: 7, marginTop: 6 } }, ...children);
}

export function paragraph(text: string, extra: PdfStyle = {}): ReactElement {
  return h(Text, { style: { marginTop: 3, ...extra } }, text);
}
