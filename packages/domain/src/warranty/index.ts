import { DAY_MS } from "../calendar/tashkent.ts";
import type { WorkCalendar } from "../order/types.ts";
import type {
  ClientFault,
  WarrantyApi,
  WarrantyDeadlines,
  WarrantyEvent,
  WarrantyStatus,
  WarrantyTransitionResult,
} from "./types.ts";

export type * from "./types.ts";

// Terms of a warranty case, in working days (WD) or calendar days (CD); see warrantyDeadlines.
const REPLY_WD = 1;
const DIAGNOSIS_WD = 2;
const LOANER_CD = 3;
const FIX_WORK_WD = 10;
const FIX_PARTS_CD = 20;
const CLIENT_FAULTS: readonly ClientFault[] = ["impact", "liquid", "overclocking", "third_party_replacement"];

/** The automaton as data (ARCHITECTURE 4.10): "status|event type" -> next status. A Map: no prototype keys. */
const TRANSITIONS = new Map<string, WarrantyStatus>([
  ["opened|START_DIAGNOSIS", "diagnosing"],
  ["diagnosing|ISSUE_LOANER", "loaner_issued"],
  ["diagnosing|SEND_TO_SUPPLIER", "at_supplier"],
  ["diagnosing|RESOLVE", "resolved"],
  ["diagnosing|REJECT", "rejected"],
  ["loaner_issued|SEND_TO_SUPPLIER", "at_supplier"],
  ["loaner_issued|RESOLVE", "resolved"],
  ["loaner_issued|REJECT", "rejected"],
  ["at_supplier|RESOLVE", "resolved"],
  ["at_supplier|REJECT", "rejected"],
  ["resolved|CLOSE", "closed"],
  ["rejected|CLOSE", "closed"],
]);

const isBlank = (v: unknown): boolean => typeof v !== "string" || v.trim() === "";

/** Refusal only with a causal link to the client (impact, liquid, overclocking, third-party replacement) and evidence. */
export function warrantyTransition(status: WarrantyStatus, e: WarrantyEvent): WarrantyTransitionResult {
  const next = TRANSITIONS.get(`${status}|${e?.type}`);
  if (next === undefined) return { ok: false, error: "invalid_transition" };
  if (e.type === "REJECT" && (!CLIENT_FAULTS.includes(e.clientFault) || isBlank(e.evidence))) {
    return { ok: false, error: "fault_evidence_missing" };
  }
  if (e.type === "ISSUE_LOANER" && isBlank(e.loanerItemId)) return { ok: false, error: "invalid_transition" };
  return { ok: true, next };
}

/**
 * Deadlines from `openedAt` (ARCHITECTURE 4.10, CONCEPT warranty terms): reply 1 and diagnosis 2 working days, loaner 3 days
 * (суток), fix 10 working days for work or 20 days for parts. "Days" without "working" are calendar days (consumer protection law art. 19).
 */
export function warrantyDeadlines(openedAt: Date, cal: WorkCalendar): WarrantyDeadlines {
  if (Number.isNaN(openedAt.getTime())) throw new RangeError("warrantyDeadlines: invalid Date");
  return {
    reply: cal.addWorkingDays(openedAt, REPLY_WD),
    diagnosis: cal.addWorkingDays(openedAt, DIAGNOSIS_WD),
    loaner: new Date(openedAt.getTime() + LOANER_CD * DAY_MS),
    fixWork: cal.addWorkingDays(openedAt, FIX_WORK_WD),
    fixParts: new Date(openedAt.getTime() + FIX_PARTS_CD * DAY_MS),
  };
}

export const warrantyApi = { warrantyTransition, warrantyDeadlines } satisfies WarrantyApi;
