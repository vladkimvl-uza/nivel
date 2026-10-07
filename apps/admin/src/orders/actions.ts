"use server";

// Server actions of the orders screens. Each is a thin frame: the session, the command (commands.ts, quote-editor.ts,
// writes.ts) and the journal of a refused attempt (action-runner.ts). The ids bound by the page (`action.bind(null, id)`)
// are encrypted by Next.js; the form brings the rest. Nothing here decides a sum or a status.
import { redirect } from "next/navigation";
import { getRuntime } from "../auth/runtime.ts";
import { runAction } from "./action-runner.ts";
import type { ActionState } from "./action-state.ts";
import { fromFormData } from "./build-event.ts";
import * as commands from "./commands.ts";
import { rebuildQuote } from "./quote-editor.ts";
import { ordersCtx, quoteCtx, writerFor } from "./runtime.ts";
import * as writes from "./writes.ts";

const orderPaths = (orderId: string) => [`/orders/${orderId}`, `/orders`, `/dashboard`, `/registry`];

export async function runEventAction(orderId: string, type: string, _prev: ActionState, data: FormData) {
  return runAction(
    {
      name: `orders.event_${type.toLowerCase()}`,
      entity: "sales.orders",
      entityId: orderId,
      revalidate: orderPaths(orderId),
    },
    (user) => commands.runEvent(ordersCtx(user), orderId, type, fromFormData(data)),
  );
}

export async function rebuildQuoteAction(orderId: string, _prev: ActionState, data: FormData) {
  return runAction(
    {
      name: "orders.quote_build",
      entity: "sales.quotes",
      entityId: orderId,
      revalidate: [`/orders/${orderId}/quote`, ...orderPaths(orderId)],
    },
    (user) => rebuildQuote(quoteCtx(user), orderId, fromFormData(data)),
  );
}

export async function sendQuoteAction(orderId: string, quoteId: string, _prev: ActionState, data: FormData) {
  return runAction(
    {
      name: "orders.quote_send",
      entity: "sales.quotes",
      entityId: quoteId,
      revalidate: [`/orders/${orderId}/quote`, ...orderPaths(orderId)],
    },
    (user) => commands.sendQuote(ordersCtx(user), orderId, quoteId, fromFormData(data)),
  );
}

export async function expectPaymentAction(orderId: string, _prev: ActionState, data: FormData) {
  return runAction(
    { name: "orders.pay_expect", entity: "sales.payments", entityId: orderId, revalidate: orderPaths(orderId) },
    (user) => commands.expectPayment(ordersCtx(user), orderId, fromFormData(data)),
  );
}

export async function confirmPaymentAction(orderId: string, _prev: ActionState, data: FormData) {
  return runAction(
    { name: "orders.pay_confirm", entity: "sales.payments", entityId: orderId, revalidate: orderPaths(orderId) },
    (user) => commands.confirmPayment(ordersCtx(user), fromFormData(data)),
  );
}

export async function voidPaymentAction(orderId: string, _prev: ActionState, data: FormData) {
  return runAction(
    { name: "orders.pay_void", entity: "sales.payments", entityId: orderId, revalidate: orderPaths(orderId) },
    (user) => commands.voidPayment(ordersCtx(user), fromFormData(data)),
  );
}

export async function reversePaymentAction(orderId: string, _prev: ActionState, data: FormData) {
  return runAction(
    { name: "orders.pay_reverse", entity: "sales.payments", entityId: orderId, revalidate: orderPaths(orderId) },
    (user) => commands.reversePayment(ordersCtx(user), fromFormData(data)),
  );
}

export async function recordPurchaseAction(orderId: string, _prev: ActionState, data: FormData) {
  return runAction(
    { name: "orders.purchase_record", entity: "sales.purchases", entityId: orderId, revalidate: orderPaths(orderId) },
    (user) => commands.recordPurchase(ordersCtx(user), orderId, fromFormData(data)),
  );
}

export async function recordConsentAction(orderId: string, _prev: ActionState, data: FormData) {
  return runAction(
    { name: "orders.consent_record", entity: "ops.consents", entityId: orderId, revalidate: orderPaths(orderId) },
    async (user) => {
      // The customer is the one of the order: the form does not name him.
      const order = await getRuntime().db.query.orders.findFirst({
        columns: { customerId: true },
        where: (t, { eq }) => eq(t.id, orderId),
      });
      if (!order) return { ok: false, message: "Заказ не найден." };
      return commands.recordConsent(ordersCtx(user), orderId, order.customerId, fromFormData(data));
    },
  );
}

export async function generateReportAction(orderId: string, _prev: ActionState, _data: FormData) {
  return runAction(
    {
      name: "orders.report_generate",
      entity: "sales.commission_reports",
      entityId: orderId,
      revalidate: orderPaths(orderId),
    },
    (user) => commands.generateReport(ordersCtx(user), orderId),
  );
}

export async function sendReportAction(orderId: string, _prev: ActionState, data: FormData) {
  return runAction(
    {
      name: "orders.report_send",
      entity: "sales.commission_reports",
      entityId: orderId,
      revalidate: orderPaths(orderId),
    },
    (user) => commands.sendReport(ordersCtx(user), orderId, fromFormData(data)),
  );
}

export async function resolveObjectionAction(orderId: string, _prev: ActionState, data: FormData) {
  return runAction(
    {
      name: "orders.objection_resolve",
      entity: "sales.commission_reports",
      entityId: orderId,
      revalidate: orderPaths(orderId),
    },
    (user) => commands.resolveObjection(ordersCtx(user), orderId, fromFormData(data)),
  );
}

export async function generateActAction(orderId: string, _prev: ActionState, data: FormData) {
  return runAction(
    { name: "orders.act_generate", entity: "sales.acts", entityId: orderId, revalidate: orderPaths(orderId) },
    (user) => commands.generateAct(ordersCtx(user), orderId, fromFormData(data)),
  );
}

export async function signActAction(orderId: string, _prev: ActionState, data: FormData) {
  return runAction(
    { name: "orders.act_sign", entity: "sales.acts", entityId: orderId, revalidate: orderPaths(orderId) },
    (user) => commands.signPaperAct(ordersCtx(user), fromFormData(data)),
  );
}

export async function savePassportAction(orderId: string, _prev: ActionState, data: FormData) {
  return runAction(
    {
      name: "orders.passport_save",
      entity: "sales.build_passports",
      entityId: orderId,
      revalidate: orderPaths(orderId),
    },
    (user, ipHash) => writes.savePassport(writerFor(user, ipHash), orderId, fromFormData(data)),
  );
}

export async function openWarrantyAction(orderId: string, _prev: ActionState, data: FormData) {
  return runAction(
    {
      name: "orders.warranty_open",
      entity: "sales.warranty_cases",
      entityId: orderId,
      revalidate: orderPaths(orderId),
    },
    (user, ipHash) => writes.openWarrantyCase(writerFor(user, ipHash), orderId, fromFormData(data)),
  );
}

export async function advanceWarrantyAction(orderId: string, caseId: string, _prev: ActionState, data: FormData) {
  return runAction(
    {
      name: "orders.warranty_advance",
      entity: "sales.warranty_cases",
      entityId: caseId,
      revalidate: orderPaths(orderId),
    },
    (user, ipHash) => writes.advanceWarranty(writerFor(user, ipHash), caseId, fromFormData(data)),
  );
}

export async function bindLeadAction(leadId: string, _prev: ActionState, data: FormData) {
  return runAction(
    { name: "orders.lead_bind", entity: "sales.leads", entityId: leadId, revalidate: ["/leads", "/dashboard"] },
    (user) => commands.bindLead(ordersCtx(user), leadId, fromFormData(data)),
  );
}

export async function convertLeadAction(leadId: string, _prev: ActionState, _data: FormData) {
  let target: string | undefined;
  const state = await runAction(
    {
      name: "orders.lead_convert",
      entity: "sales.leads",
      entityId: leadId,
      revalidate: ["/leads", "/orders", "/dashboard"],
    },
    async (user) => {
      const outcome = await commands.convertLead(ordersCtx(user), leadId);
      if (outcome.ok && outcome.id) target = `/orders/${outcome.id}`;
      return outcome;
    },
  );
  // The redirect is thrown, so it stays outside the frame that catches whatever the work throws.
  if (target) redirect(target);
  return state;
}

export async function addOtherIncomeAction(_prev: ActionState, data: FormData) {
  return runAction(
    { name: "registry.other_income_add", entity: "sales.other_income", revalidate: ["/registry", "/dashboard"] },
    (user, ipHash) => writes.addOtherIncome(writerFor(user, ipHash), fromFormData(data)),
  );
}

export async function requestPdfAction(orderId: string, orderNumber: string, _prev: ActionState, data: FormData) {
  return runAction(
    { name: "orders.pdf_request", entity: "sales.orders", entityId: orderId, revalidate: [`/orders/${orderId}`] },
    (user) => commands.requestPdf(ordersCtx(user), orderId, orderNumber, fromFormData(data)),
  );
}
