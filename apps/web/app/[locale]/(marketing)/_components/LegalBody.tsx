import { type Block, type Inline, parseMarkdown } from "../../../../src/i18n/site/legal.ts";

function inline(nodes: readonly Inline[]) {
  return nodes.map((n, i) => {
    const key = `${n.type}-${i}`;
    switch (n.type) {
      case "text":
        return n.text;
      case "strong":
        return <strong key={key}>{n.text}</strong>;
      case "em":
        return <em key={key}>{n.text}</em>;
      case "code":
        return <code key={key}>{n.text}</code>;
      case "link": {
        const external = /^https?:/i.test(n.href);
        return (
          <a key={key} href={n.href} {...(external ? { rel: "noopener noreferrer", target: "_blank" } : {})}>
            {n.text}
          </a>
        );
      }
      default:
        return null;
    }
  });
}

function block(b: Block, i: number) {
  switch (b.type) {
    case "heading": {
      // The page has its own h1: the first-level heading of the document is a second-level one on the page.
      const level = Math.min(4, b.level + 1) as 2 | 3 | 4;
      const Tag = `h${level}` as const;
      return <Tag key={i}>{inline(b.inline)}</Tag>;
    }
    case "paragraph":
      return <p key={i}>{inline(b.inline)}</p>;
    case "list": {
      const Tag = b.ordered ? "ol" : "ul";
      return (
        <Tag key={i}>
          {b.items.map((item, k) => (
            <li key={k}>{inline(item)}</li>
          ))}
        </Tag>
      );
    }
  }
}

/** Draws the Markdown of a legal document. React escapes every text: there is no way to bring markup in. */
export function LegalBody({ markdown, skipTitle = true }: { markdown: string; skipTitle?: boolean }) {
  const blocks = parseMarkdown(markdown);
  const rest = skipTitle && blocks[0]?.type === "heading" && blocks[0].level === 1 ? blocks.slice(1) : blocks;
  return <div className="legal-body">{rest.map(block)}</div>;
}
