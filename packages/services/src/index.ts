// Use cases on top of db + domain (ARCHITECTURE 4.13). Other scenarios (leads, quotes, payments, purchases,
// reports, acts, configs, consents, threshold, outbox) are added by WP-07 under src/<area>/.
export { type ActorRef, type DispatchResult, dispatch } from "./orders/dispatch.ts";
