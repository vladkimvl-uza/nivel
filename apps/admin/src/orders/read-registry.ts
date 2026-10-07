// The registry "received = purchased + returned" (DECISIONS R-7, ARCHITECTURE 6.3): per order, from the journals of the
// payments and the purchases; the difference is made by the database in the same query. Plus the income of the other
// activity of the sole proprietor and the CSV for the accountant. Customers are not named: the accountant gets order numbers.
import type { Db } from "@nivel/db";

export interface RegistryRow {
  orderId: string;
  number: string;
  status: string;
  /** Confirmed money for purchases, reversals included. */
  received: number;
  /** Sum of the purchases, returns to shops taken off. */
  purchased: number;
  /** Confirmed remainder and funds returned to the customer. */
  returned: number;
  /** Losses with documents entered at the cancellation. */
  losses: number;
  /** received − purchased − returned − losses: zero when the order is reconciled. */
  difference: number;
  /** The fee received (advance, final part, extra, "Podbor"). */
  feeIn: number;
  feeRefunded: number;
}

const num = (v: unknown): number => Number(v ?? 0);

export async function listRegistry(db: Db, year: number): Promise<RegistryRow[]> {
  const { rows } = await db.$client.query<{
    id: string;
    number: string;
    status: string;
    funds: string;
    spent: string;
    refunded: string;
    losses: string;
    fee_in: string;
    fee_refund: string;
  }>(
    `with pay as (
       select order_id,
              sum(amount_sum) filter (where kind in ('purchase_funds', 'purchase_topup')) as funds,
              sum(amount_sum) filter (where kind in ('remainder_refund', 'funds_refund')) as refunded,
              sum(amount_sum) filter (where kind in ('fee_advance', 'fee_final', 'fee_extra', 'podbor_fee')) as fee_in,
              sum(amount_sum) filter (where kind = 'fee_refund') as fee_refund
         from sales.payments where status = 'confirmed' group by order_id),
     buy as (select order_id, sum(amount_sum) as spent from sales.purchases group by order_id)
     select o.id, o.number, o.status,
            coalesce(pay.funds, 0)::text as funds, coalesce(buy.spent, 0)::text as spent,
            coalesce(pay.refunded, 0)::text as refunded, o.documented_losses_sum::text as losses,
            coalesce(pay.fee_in, 0)::text as fee_in, coalesce(pay.fee_refund, 0)::text as fee_refund
       from sales.orders o
       left join pay on pay.order_id = o.id
       left join buy on buy.order_id = o.id
      where exists (select 1 from sales.payments p
                     where p.order_id = o.id and p.status = 'confirmed'
                       and extract(year from p.confirmed_at at time zone 'Asia/Tashkent')::int = $1)
         or exists (select 1 from sales.purchases pu
                     where pu.order_id = o.id
                       and extract(year from pu.bought_at at time zone 'Asia/Tashkent')::int = $1)
      order by o.number`,
    [year],
  );
  return rows.map((r) => {
    const received = num(r.funds);
    const purchased = num(r.spent);
    const returned = num(r.refunded);
    const losses = num(r.losses);
    return {
      orderId: r.id,
      number: r.number,
      status: r.status,
      received,
      purchased,
      returned,
      losses,
      difference: received - purchased - returned - losses,
      feeIn: num(r.fee_in),
      feeRefunded: num(r.fee_refund),
    };
  });
}

export interface OtherIncomeRow {
  id: string;
  year: number;
  period: string;
  amountSum: number;
  note: string | null;
  enteredBy: string | null;
  createdAt: Date;
}

export async function listOtherIncome(db: Db, year: number): Promise<OtherIncomeRow[]> {
  const { rows } = await db.$client.query<{
    id: string;
    year: number;
    period: string;
    amount_sum: string;
    note: string | null;
    entered_by: string | null;
    created_at: Date;
  }>(
    "select id, year, period, amount_sum::text as amount_sum, note, entered_by, created_at from sales.other_income where year = $1 order by period, created_at",
    [year],
  );
  return rows.map((r) => ({
    id: r.id,
    year: r.year,
    period: r.period,
    amountSum: num(r.amount_sum),
    note: r.note,
    enteredBy: r.entered_by,
    createdAt: r.created_at,
  }));
}

/** Years that have deals or other income, newest first: for the choice of the year. */
export async function listRegistryYears(db: Db, currentYear: number): Promise<number[]> {
  const { rows } = await db.$client.query<{ year: number }>(
    "select year from sales.v_deal_volume_by_year order by year desc",
  );
  return [...new Set([currentYear, ...rows.map((r) => r.year)])].sort((a, b) => b - a);
}

// ---- the CSV for the accountant -------------------------------------------------------------------------------------
const HEADER = [
  "Вид",
  "Номер",
  "Статус",
  "Поступило на закупку",
  "Закуплено",
  "Возвращено",
  "Потери с документами",
  "Расхождение",
  "Плата получена",
  "Плата возвращена",
  "Доход другой деятельности ИП",
  "Период",
  "Примечание",
];

/** A cell that a spreadsheet would read as a formula gets an apostrophe (CSV injection); quotes are doubled. */
export function csvCell(value: string | number): string {
  const text = String(value);
  const safe = /^[=+\-@\t\r]/.test(text) && !/^-?\d+$/.test(text) ? `'${text}` : text;
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Semicolons and a BOM: the way Excel of a Russian-language machine opens a UTF-8 file. Sums are whole numbers of sums. */
export function registryCsv(
  rows: readonly RegistryRow[],
  income: readonly OtherIncomeRow[],
  statusLabel: (s: string) => string,
): string {
  const lines: (string | number)[][] = [HEADER];
  for (const r of rows) {
    lines.push([
      "Заказ",
      r.number,
      statusLabel(r.status),
      r.received,
      r.purchased,
      r.returned,
      r.losses,
      r.difference,
      r.feeIn,
      r.feeRefunded,
      "",
      "",
      "",
    ]);
  }
  for (const i of income) {
    lines.push([
      "Доход другой деятельности ИП",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      i.amountSum,
      i.period,
      i.note ?? "",
    ]);
  }
  return `﻿${lines.map((l) => l.map(csvCell).join(";")).join("\r\n")}\r\n`;
}
