import type { ReactNode } from "react";
import { cx } from "./cx.ts";
import { Money } from "./Money.tsx";

export type SumKind = "line" | "subtotal" | "refund" | "total";

export interface SumLine {
  /** Unique within the table: the row key. */
  id: string;
  label: ReactNode;
  /** Whole sums; a refund is negative. The amounts are computed on the server, never here. */
  amount: number;
  kind?: SumKind | undefined;
}

/**
 * Table of sums of a document (use inside `Paper`): plain lines in the body; subtotals, the refund and the total
 * in the footer in the order given (the total gets the double rule). Only displays: it does not add anything up.
 */
export function SumsTable({ caption, unit, lines }: { caption: string; unit: string; lines: readonly SumLine[] }) {
  const ids = new Set<string>();
  for (const l of lines) {
    if (ids.has(l.id)) throw new Error(`SumsTable: duplicate row id ${JSON.stringify(l.id)}`);
    ids.add(l.id);
  }
  const row = (l: SumLine) => {
    const kind = l.kind ?? "line";
    return (
      <tr key={l.id} className={cx("nv-sums__row", kind !== "line" && `nv-sums__row--${kind}`)}>
        <th scope="row">{l.label}</th>
        <td>
          <Money amount={l.amount} unit={unit} />
        </td>
      </tr>
    );
  };
  const body = lines.filter((l) => (l.kind ?? "line") === "line");
  const foot = lines.filter((l) => (l.kind ?? "line") !== "line");
  return (
    <table className="nv-sums">
      <caption className="nv-sr">{caption}</caption>
      <tbody>{body.map(row)}</tbody>
      {foot.length > 0 ? <tfoot>{foot.map(row)}</tfoot> : null}
    </table>
  );
}
