// Use cases on top of db + domain (ARCHITECTURE 4.13). WP-07 scenarios, one namespace per area.
export * as acts from "./acts/index.ts";
export * as configs from "./configs/index.ts";
export * as consents from "./consents/index.ts";
export * as leads from "./leads/index.ts";
export { type ActorRef, type DispatchResult, dispatch } from "./orders/dispatch.ts";
export * as orders from "./orders/index.ts";
export * as outbox from "./outbox/index.ts";
export * as payments from "./payments/index.ts";
export * as purchases from "./purchases/index.ts";
export * as quotes from "./quotes/index.ts";
export * as reports from "./reports/index.ts";
export * as threshold from "./threshold/index.ts";
