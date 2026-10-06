import type { ReactNode } from "react";
import { cx } from "./cx.ts";
import { Money } from "./Money.tsx";

export interface EstimateLabels {
  /** Header of the number column. */
  index: string;
  name: string;
  /** Header of the amount column; put the unit here, e.g. "Сумма, сум". */
  amount: string;
}

/** The estimate table of a document (use inside `Paper`): hidden caption, real column headers. */
export function EstimateTable({
  caption,
  labels,
  children,
}: {
  caption: string;
  labels: EstimateLabels;
  /** `EstimateRow`s. */
  children?: ReactNode;
}) {
  return (
    <table className="nv-est">
      <caption className="nv-sr">{caption}</caption>
      <thead>
        <tr>
          <th scope="col" className="nv-est__i">
            {labels.index}
          </th>
          <th scope="col">{labels.name}</th>
          <th scope="col" className="nv-est__amount">
            {labels.amount}
          </th>
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

/** One line of the estimate: number, name with an optional note, amount in whole sums. */
export function EstimateRow({
  index,
  name,
  note,
  amount,
  unit,
  kind = "item",
}: {
  /** A number gets two digits (`3` -> `03`); a string is shown as is. */
  index?: number | string;
  name: ReactNode;
  note?: ReactNode;
  amount: number;
  /** Usually in the column header instead. */
  unit?: string;
  /** A refund to the customer is shown in the refund color with a minus. */
  kind?: "item" | "refund";
}) {
  const i = typeof index === "number" ? String(index).padStart(2, "0") : index;
  return (
    <tr className={cx("nv-est__row", kind === "refund" && "nv-est__row--refund")}>
      <td className="nv-est__i">{i}</td>
      <td className="nv-est__name">
        {name}
        {note ? <small>{note}</small> : null}
      </td>
      <td className="nv-est__amount">
        <Money amount={amount} {...(unit === undefined ? {} : { unit })} />
      </td>
    </tr>
  );
}
