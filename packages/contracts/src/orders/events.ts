// The input of `services.orders.dispatch` (ARCHITECTURE 4.9, 4.13): who acts and which event. The event repeats the
// frozen `OrderEvent` union; the compiler checks that the output of the schema is an `OrderEvent`.
import type { CancelSettlement } from "@nivel/domain/cancel";
import type { OrderEvent } from "@nivel/domain/order";
import { z } from "zod";
import { InstantSchema, sumBetween, textUpTo, UuidSchema } from "./common.ts";

export const ACTOR_KINDS = ["system", "customer", "owner", "assistant"] as const;

/** Admin user id, Telegram user id of an owner or assistant in the bot, customer id, or "system". */
export const ActorRefSchema = z.strictObject({
  kind: z.enum(ACTOR_KINDS),
  id: textUpTo(64),
});

export const CANCEL_POINTS = [
  "before_accept",
  "after_accept_before_purchase",
  "after_purchase_before_assembly",
  "during_assembly",
  "after_tests_before_handover",
] as const;

const money = sumBetween(0);

export const CancelSettlementSchema = z.strictObject({
  feeEarned: money,
  feeToRefund: money,
  feeToInvoice: money,
  fundsToRefund: money,
  partsGoTo: z.enum(["none", "client", "shop_or_client"]),
  dueBy: InstantSchema,
}) satisfies z.ZodType<CancelSettlement>;

const event = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.strictObject({ type: z.literal(type), ...shape });

/** Events of the order automaton. The amounts inside CANCEL are checked in form only: the server recomputes them. */
export const OrderEventSchema = z.discriminatedUnion("type", [
  event("SEND_ESTIMATE", { quoteId: UuidSchema, manuallyChecked: z.literal(true) }),
  event("EXPIRE", {}),
  event("REVISE", {}),
  event("ACCEPT", {
    quoteId: UuidSchema,
    consentIds: z.array(UuidSchema).max(12),
    channel: z.enum(["bot", "site", "tma"]),
  }),
  event("FEE_PREPAID", { paymentId: UuidSchema }),
  event("FUNDS_RECEIVED", { paymentIds: z.array(UuidSchema).min(1).max(50), receivedAt: InstantSchema }),
  event("MEETING_DONE", {}),
  event("START_PURCHASE", {}),
  event("PURCHASE_RECORDED", { purchaseId: UuidSchema }),
  event("PURCHASE_DONE", {}),
  event("SEND_REPORT", { reportId: UuidSchema }),
  event("OBJECTION", { text: textUpTo(2000) }),
  event("REPORT_ACCEPTED", {}),
  event("REPORT_DEEMED_ACCEPTED", {}),
  event("REMAINDER_SETTLED", { refundPaymentId: UuidSchema.exactOptional() }),
  event("MATERIALS_ACCEPTED", { actId: UuidSchema }),
  event("ASSEMBLED", {}),
  // The passport of an order is the row of build_passports whose key is the order id.
  event("TESTS_PASSED", { passportId: UuidSchema }),
  event("DISPATCH", {}),
  event("HANDOVER", { actId: UuidSchema, finalPaymentId: UuidSchema }),
  event("CLOSE", {}),
  event("PODBOR_DELIVERED", { paymentId: UuidSchema }),
  event("CANCEL", { point: z.enum(CANCEL_POINTS), reason: textUpTo(500), settlement: CancelSettlementSchema }),
  event("CANCEL_SETTLED", {}),
]) satisfies z.ZodType<OrderEvent>;

export const DispatchInputSchema = z.strictObject({
  orderId: UuidSchema,
  event: OrderEventSchema,
  actor: ActorRefSchema,
});

export type ActorRefInput = z.infer<typeof ActorRefSchema>;
export type DispatchInput = z.infer<typeof DispatchInputSchema>;
