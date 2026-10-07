import type { ReactNode } from "react";
import "../../src/orders/orders.css";
import { requireSignedIn } from "../../src/orders/next.ts";
import { OrdersShell } from "../../src/orders/ui/OrdersShell.tsx";

export const dynamic = "force-dynamic";

export default async function OrdersLayout({ children }: { children: ReactNode }) {
  const user = await requireSignedIn();
  return <OrdersShell user={user}>{children}</OrdersShell>;
}
