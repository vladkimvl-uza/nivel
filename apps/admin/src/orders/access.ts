// Who may do what in the sections of WP-11 (ARCHITECTURE 6.1). The permissions of the admin kit (`auth/roles.ts`) are
// a closed list of the base package; these sections keep their own table of the same shape, and every page and every
// server action asks it through `requireOrdersUser` (next.ts). Money is the owner's: the assistant has no money button.
import type { Role } from "../auth/roles.ts";

export const ORDERS_PERMISSIONS = {
  "orders.read": ["owner", "assistant"],
  "leads.work": ["owner", "assistant"],
  /** The estimate: build and edit (the owner checks it). */
  "quotes.write": ["owner"],
  /** Send the estimate to the customer: a money event, the owner's. */
  "quotes.send": ["owner"],
  /** Expect, confirm, void a payment; the number of the fiscal receipt. */
  "payments.write": ["owner"],
  /** Money events of the order: prepaid, funds received, start of the purchase, remainder, handover, return of the estimate. */
  "orders.settle": ["owner"],
  "orders.cancel": ["owner"],
  /** Report of the commission: generate, send, answer an objection; the end of the purchases. */
  "reports.write": ["owner"],
  /** The consents that move money (over the limit, no receipt, replacement, third-party payer). */
  "consents.money": ["owner"],
  "purchases.write": ["owner", "assistant"],
  "assembly.write": ["owner", "assistant"],
  "acts.write": ["owner", "assistant"],
  /** A paper act is recorded by the owner (acts.sign refuses the assistant). */
  "acts.sign": ["owner"],
  "passport.write": ["owner", "assistant"],
  "warranty.write": ["owner", "assistant"],
  /** Queue the rendering of a PDF document (WP-12); it moves no money. Behind the switch `feature.pdf`. */
  "pdf.render": ["owner", "assistant"],
  "registry.read": ["owner", "accountant"],
  "registry.write": ["owner"],
  "registry.export": ["owner", "accountant"],
} as const satisfies Record<string, readonly Role[]>;

export type OrdersPermission = keyof typeof ORDERS_PERMISSIONS;

export function canDo(role: Role, permission: OrdersPermission): boolean {
  return (ORDERS_PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export interface OrdersNavItem {
  href: string;
  label: string;
  anyOf: OrdersPermission[];
}

export const ORDERS_NAV: OrdersNavItem[] = [
  { href: "/dashboard", label: "Сводка", anyOf: ["orders.read"] },
  { href: "/leads", label: "Заявки", anyOf: ["leads.work"] },
  { href: "/orders", label: "Заказы", anyOf: ["orders.read"] },
  { href: "/registry", label: "Порог и учёт", anyOf: ["registry.read"] },
];

export function visibleOrdersNav(role: Role): OrdersNavItem[] {
  return ORDERS_NAV.filter((item) => item.anyOf.some((p) => canDo(role, p)));
}
