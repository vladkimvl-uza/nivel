import { UuidSchema } from "@nivel/contracts/orders";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getRuntime } from "../../../../src/auth/runtime.ts";
import { canDo } from "../../../../src/orders/access.ts";
import { featureOn, PDF_FLAG } from "../../../../src/orders/flags.ts";
import { requireOrdersUser } from "../../../../src/orders/next.ts";
import { getOrderCard } from "../../../../src/orders/read-orders.ts";
import { listVendors } from "../../../../src/orders/read-quote.ts";
import { CardHeader, MoneyBlock } from "../../../../src/orders/ui/CardHeader.tsx";
import {
  ActsBlock,
  PassportBlock,
  PdfBlock,
  ReportBlock,
  WarrantyBlock,
} from "../../../../src/orders/ui/DocumentsBlocks.tsx";
import { NextSteps } from "../../../../src/orders/ui/NextSteps.tsx";
import { PaymentsBlock } from "../../../../src/orders/ui/PaymentsBlock.tsx";
import { PurchasesBlock } from "../../../../src/orders/ui/PurchasesBlock.tsx";
import { QuoteBlock } from "../../../../src/orders/ui/QuoteBlock.tsx";
import { Timeline } from "../../../../src/orders/ui/Timeline.tsx";

export const metadata: Metadata = { title: "Заказ" };
export const dynamic = "force-dynamic";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireOrdersUser(["orders.read"]);
  const { id } = await params;
  if (!UuidSchema.safeParse(id).success) notFound();
  const { db } = getRuntime();
  const card = await getOrderCard(db, id, { seePhone: user.role === "owner" });
  if (!card) notFound();
  const [vendors, pdfOn] = await Promise.all([listVendors(db), featureOn(db, PDF_FLAG)]);
  const role = user.role;
  return (
    <>
      <CardHeader card={card} />
      <NextSteps card={card} role={role} />
      <MoneyBlock card={card} />
      <QuoteBlock card={card} canEdit={canDo(role, "quotes.write") && card.order.status === "estimate_draft"} />
      <PaymentsBlock card={card} canWrite={canDo(role, "payments.write")} />
      <PurchasesBlock
        card={card}
        vendors={vendors}
        canRecord={canDo(role, "purchases.write")}
        canConsent={canDo(role, "consents.money")}
      />
      <ReportBlock card={card} canWrite={canDo(role, "reports.write")} />
      <ActsBlock card={card} canGenerate={canDo(role, "acts.write")} canSign={canDo(role, "acts.sign")} />
      <PassportBlock card={card} canWrite={canDo(role, "passport.write")} />
      <WarrantyBlock card={card} canWrite={canDo(role, "warranty.write")} />
      {pdfOn ? <PdfBlock card={card} canRender={canDo(role, "pdf.render")} /> : null}
      <Timeline card={card} />
    </>
  );
}
