// The requisites of the sole proprietor in a document, and the guard against a card number (CLAUDE.md: "the number of a
// personal card appears neither in a template nor in a text"). The money for purchases goes to the account of the IP only;
// the fee goes by QR Xolis. Until the IP is registered every requisite is a placeholder ("roʻyxatdan oʻtgach").

import { Text, View } from "@react-pdf/renderer";
import { createElement as h, type ReactElement } from "react";
import { band, keyValue, section, style } from "./kit.ts";
import type { T } from "./messages.ts";
import type { IpRequisites } from "./types.ts";

/** Sixteen digits, alone or in groups of four, not a part of a longer run of digits. */
const CARD_NUMBER = /(?<![0-9])[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4}(?![0-9])/;
/** The account of a company is twenty digits, often written in five groups of four: it is not a card. */
const ACCOUNT_OF_TWENTY = /(?<![0-9])[0-9]{4}(?:[ -]?[0-9]{4}){4}(?![0-9])/g;

export class CardNumberError extends Error {
  readonly field: string;
  constructor(field: string) {
    super(`${field} holds a number that looks like a bank card: a card never goes into a document`);
    this.name = "CardNumberError";
    this.field = field;
  }
}

export const looksLikeCard = (text: string): boolean => CARD_NUMBER.test(text.replace(ACCOUNT_OF_TWENTY, ""));

export function assertNoCardNumber(field: string, ...values: readonly (string | null | undefined)[]): void {
  for (const v of values) if (typeof v === "string" && looksLikeCard(v)) throw new CardNumberError(field);
}

/** Fields that carry long numbers by their nature: the numbers of receipts, invoices and serials, codes of the passport. */
const NUMBER_FIELDS = new Set(["receiptNo", "esfNo", "serial", "serials", "value", "labelCode", "qr", "account", "no"]);

/** Looks through a document for a card number in any text, except the fields above; names the path of the first one. */
export function assertNoCardNumberDeep(data: unknown, path = ""): void {
  if (typeof data === "string") {
    assertNoCardNumber(path === "" ? "document" : path, data);
    return;
  }
  if (Array.isArray(data)) {
    data.forEach((item, i) => {
      assertNoCardNumberDeep(item, path === "" ? String(i) : `${path}.${i}`);
    });
    return;
  }
  if (data !== null && typeof data === "object") {
    for (const [key, value] of Object.entries(data)) {
      if (NUMBER_FIELDS.has(key)) continue;
      assertNoCardNumberDeep(value, path === "" ? key : `${path}.${key}`);
    }
  }
}

export interface RequisiteRow {
  label: string;
  value: string;
  /** The value is the placeholder: the requisite does not exist yet. */
  pending: boolean;
}

const FIELDS = [
  ["holder", "requisites.holder"],
  ["inn", "requisites.inn"],
  ["bank", "requisites.bank"],
  ["account", "requisites.account"],
  ["mfo", "requisites.mfo"],
] as const;

const clean = (v: string | null | undefined): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

/** Holder, INN, bank, account, MFO: a missing one is the placeholder, a card number is refused. */
export function requisiteRows(req: IpRequisites | null | undefined, t: T): RequisiteRow[] {
  return FIELDS.map(([field, label]) => {
    const value = clean(req?.[field]);
    if (value !== null) assertNoCardNumber(`requisites.${field}`, value);
    return { label: t(label), value: value ?? t("common.pending"), pending: value === null };
  });
}

/** The purpose of the payment: the words of the owner with `{number}` replaced, or the standard text "without VAT". */
export function paymentPurpose(req: IpRequisites | null | undefined, orderNumber: string, t: T): string {
  const own = clean(req?.purpose);
  if (own !== null) {
    assertNoCardNumber("requisites.purpose", own);
    return own.replaceAll("{number}", orderNumber);
  }
  return t("requisites.purpose_default", { number: orderNumber });
}

/**
 * The block "requisites for the money of purchases" of the estimate: the account of the IP, the purpose of the payment, the note
 * that the money goes to this account only and the fee goes by QR Xolis. There is no place in it for a card.
 */
export function requisitesBlock(req: IpRequisites | null | undefined, orderNumber: string, t: T): ReactElement {
  const rows = requisiteRows(req, t);
  const purpose = paymentPurpose(req, orderNumber, t);
  return section(
    t("requisites.title"),
    band(
      ...rows.map((r, i) => keyValue(r.label, r.value, { pending: r.pending, mono: !r.pending && i >= 1 })),
      keyValue(t("requisites.purpose"), purpose),
    ),
    h(
      View,
      { style: { marginTop: 4 } },
      h(Text, { style: style.small }, t("requisites.note")),
      h(Text, { style: style.small }, t("requisites.fee_channel")),
    ),
  );
}
