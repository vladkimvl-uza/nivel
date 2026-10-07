"use server";

// Server actions of the orders screens. Each is a thin frame: the session, the command (commands.ts, quote-editor.ts,
// writes.ts) and the journal of a refused attempt (action-runner.ts). The ids the page binds (`action.bind(null, id)`)
// travel through the browser in the clear, like the fields of the form: all of them are input of an untrusted person.
// What is safe about them is that the role is checked first and the services check the ids again (an order, a payment, a
// quote of the order); a command that needs a fact (the number of an order, the customer) reads it from the database.
// Nothing here decides a sum or a status.
import { redirect } from "next/navigation";
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
    (user, ipHash) => commands.runEvent(ordersCtx(user, ipHash), orderId, type, fromFormData(data)),
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
    (user, ipHash) => rebuildQuote(quoteCtx(user, ipHash), orderId, fromFormData(data)),
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
    (user, ipHash) => commands.sendQuote(ordersCtx(user, ipHash), orderId, quoteId, fromFormData(data)),
  );
}

export async function expectPaymentAction(orderId: string, _prev: ActionState, data: FormData) {
  return runAction(
    { name: "orders.pay_expect", entity: "sales.payments", entityId: orderId, revalidate: orderPaths(orderId) },
    (user, ipHash) => commands.expectPayment(ordersCtx(user, ipHash), orderId, fromFormData(data)),
  );
}

export async function confirmPaymentAction(orderId: string, _prev: ActionState, data: FormData) {
  return runAction(
    { name: "orders.pay_confirm", entity: "sales.payments", entityId: orderId, revalidate: orderPaths(orderId) },
    (user, ipHash) => commands.confirmPayment(ordersCtx(user, ipHash), fromFormData(data)),
  );
}

export async function voidPaymentAction(orderId: string, _prev: ActionState, data: FormData) {
  return runAction(
    { name: "orders.pay_void", entity: "sales.payments", entityId: orderId, revalidate: orderPaths(orderId) },
    (user, ipHash) => commands.voidPayment(ordersCtx(user, ipHash), fromFormData(data)),
  );
}

export async function reversePaymentAction(orderId: string, _prev: ActionState, data: FormData) {
  return runAction(
    { name: "orders.pay_reverse", entity: "sales.payments", entityId: orderId, revalidate: orderPaths(orderId) },
    (user, ipHash) => commands.reversePayment(ordersCtx(user, ipHash), fromFormData(data)),
  );
}

export async function recordPurchaseAction(orderId: string, _prev: ActionState, data: FormData) {
  return runAction(
    { name: "orders.purchase_record", entity: "sales.purchases", entityId: orderId, revalidate: orderPaths(orderId) },
    (user, ipHash) => commands.recordPurchase(ordersCtx(user, ipHash), orderId, fromFormData(data)),
  );
}

export async function recordConsentAction(orderId: string, _prev: ActionState, data: FormData) {
  return runAction(
    { name: "orders.consent_record", entity: "ops.consents", entityId: orderId, revalidate: orderPaths(orderId) },
    // The customer is the one of the order: the command reads him from the database after the role is checked.
    (user, ipHash) => commands.recordConsent(ordersCtx(user, ipHash), orderId, fromFormData(data)),
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
    (user, ipHash) => commands.generateReport(ordersCtx(user, ipHash), orderId),
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
    (user, ipHash) => commands.sendReport(ordersCtx(user, ipHash), orderId, fromFormData(data)),
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
    (user, ipHash) => commands.resolveObjection(ordersCtx(user, ipHash), orderId, fromFormData(data)),
  );
}

export async function generateActAction(orderId: string, _prev: ActionState, data: FormData) {
  return runAction(
    { name: "orders.act_generate", entity: "sales.acts", entityId: orderId, revalidate: orderPaths(orderId) },
    (user, ipHash) => commands.generateAct(ordersCtx(user, ipHash), orderId, fromFormData(data)),
  );
}

export async function signActAction(orderId: string, _prev: ActionState, data: FormData) {
  return runAction(
    { name: "orders.act_sign", entity: "sales.acts", entityId: orderId, revalidate: orderPaths(orderId) },
    (user, ipHash) => commands.signPaperAct(ordersCtx(user, ipHash), fromFormData(data)),
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
    (user, ipHash) => commands.bindLead(ordersCtx(user, ipHash), leadId, fromFormData(data)),
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
    async (user, ipHash) => {
      const outcome = await commands.convertLead(ordersCtx(user, ipHash), leadId);
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

export async function requestPdfAction(orderId: string, _prev: ActionState, data: FormData) {
  return runAction(
    { name: "orders.pdf_request", entity: "sales.orders", entityId: orderId, revalidate: [`/orders/${orderId}`] },
    (user, ipHash) => commands.requestPdf(ordersCtx(user, ipHash), orderId, fromFormData(data)),
  );
}
