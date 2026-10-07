// The legal pages (ARCHITECTURE 5.1, 10.2): the text comes from `content.legal_documents`; a document that is not published yet
// (a stub, or approved by the lawyer but not in force) is shown with the plaque «Draft until the lawyer has checked it».
// Without any row the page shows the text built into the site (messages `site.legal.*`), also as a draft. The text of a
// document is Markdown without raw HTML (DATA-MAP); this file reads it into blocks, the page draws them with React, which
// escapes every text, so there is no way to bring markup in.

export const LEGAL_DOCS = [
  { slug: "offer", kind: "offer" },
  { slug: "privacy", kind: "privacy" },
  { slug: "warranty", kind: "warranty" },
  { slug: "returns", kind: "returns" },
  { slug: "consent-pd", kind: "consent_pd" },
  { slug: "stage-tariff", kind: "stage_tariff" },
] as const;

export type LegalSlug = (typeof LEGAL_DOCS)[number]["slug"];
export type LegalKind = (typeof LEGAL_DOCS)[number]["kind"];

export function legalKindOf(slug: string): LegalKind | null {
  return LEGAL_DOCS.find((d) => d.slug === slug)?.kind ?? null;
}

export interface LegalRow {
  kind: string;
  version: string;
  lang: "uz" | "ru";
  bodyMd: string;
  status: "stub" | "lawyer_approved" | "published";
  textSha256: string;
  /** `yyyy-mm-dd`; a published version always has it. */
  effectiveFrom: string | null;
  createdAt: Date;
}

/**
 * The version to show: the newest published one that is already in force, else the newest unpublished one (a draft), else
 * nothing. `today` is `yyyy-mm-dd` in Tashkent.
 */
export function pickLegalDocument(
  rows: readonly LegalRow[],
  kind: string,
  lang: "uz" | "ru",
  today: string,
): LegalRow | null {
  const mine = rows.filter((r) => r.kind === kind && r.lang === lang);
  const inForce = mine
    .filter((r) => r.status === "published" && r.effectiveFrom !== null && r.effectiveFrom <= today)
    .sort(
      (a, b) =>
        (b.effectiveFrom as string).localeCompare(a.effectiveFrom as string) ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    );
  if (inForce[0]) return inForce[0];
  const drafts = mine
    .filter((r) => r.status !== "published")
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return drafts[0] ?? null;
}

// ---- Markdown without raw HTML -------------------------------------------------------------------------------------

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; text: string }
  | { type: "em"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string };

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4; inline: Inline[] }
  | { type: "paragraph"; inline: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] };

/** Addresses a link may have: web, mail, phone, a path of the site, an anchor. Never `javascript:`, `data:` or `//host`. */
export function safeHref(href: string): string | null {
  if (/^(?:https?:\/\/|mailto:|tel:)[^\s\u0000-\u001f]+$/i.test(href)) return href;
  if (/^\/(?!\/)[^\s\u0000-\u001f]*$/.test(href) || /^#[^\s]*$/.test(href)) return href;
  return null;
}

const LINK = /\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/y;
const STRONG = /\*\*(?=\S)([^*\n]*[^*\s])\*\*/y;
const EM = /\*(?=[^\s*])([^*\n]*[^*\s])\*/y;
const CODE = /`([^`\n]+)`/y;

function matchAt(re: RegExp, text: string, at: number): RegExpExecArray | null {
  re.lastIndex = at;
  return re.exec(text);
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let plain = "";
  const flush = () => {
    if (plain !== "") out.push({ type: "text", text: plain });
    plain = "";
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    let m: RegExpExecArray | null = null;
    if (ch === "[" && (m = matchAt(LINK, text, i))) {
      const href = safeHref(m[2] as string);
      if (href) {
        flush();
        out.push({ type: "link", text: m[1] as string, href });
      } else {
        plain += m[1] as string;
      }
    } else if (ch === "*" && (m = matchAt(STRONG, text, i))) {
      flush();
      out.push({ type: "strong", text: m[1] as string });
    } else if (ch === "*" && (m = matchAt(EM, text, i))) {
      flush();
      out.push({ type: "em", text: m[1] as string });
    } else if (ch === "`" && (m = matchAt(CODE, text, i))) {
      flush();
      out.push({ type: "code", text: m[1] as string });
    } else {
      plain += ch;
      i += 1;
      continue;
    }
    i += m[0].length;
  }
  flush();
  return out;
}

const HEADING = /^(#{1,4})\s+(.+?)\s*#*\s*$/;
const BULLET = /^[-*]\s+(.*)$/;
const NUMBERED = /^\d+[.)]\s+(.*)$/;

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: Inline[][] } | null = null;
  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push({ type: "paragraph", inline: parseInline(paragraph.join(" ")) });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ type: "list", ordered: list.ordered, items: list.items });
    list = null;
  };
  for (const raw of md.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (line === "") {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      blocks.push({
        type: "heading",
        level: (heading[1] as string).length as 1 | 2 | 3 | 4,
        inline: parseInline(heading[2] as string),
      });
    } else if (bullet || numbered) {
      flushParagraph();
      const ordered = numbered !== null && bullet === null;
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push(parseInline(((bullet ?? numbered) as RegExpExecArray)[1] as string));
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}
