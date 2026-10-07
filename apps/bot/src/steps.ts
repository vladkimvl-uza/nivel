// The steps of a dialog with a customer (ARCHITECTURE 7.1: "an automaton of its own in the session, without the
// conversations plugin"). A button or a message is accepted only in the step it belongs to: the buttons of an old
// message do not push the dialog around.

export const STEPS = [
  "idle",
  "sel_task",
  "sel_band",
  "sel_scope",
  "sel_wishes",
  "sel_result",
  "req_contact",
  "req_district",
  "req_term",
  "report_question",
  "warranty_pick",
  "warranty_text",
] as const;
export type Step = (typeof STEPS)[number];

export type StepEvent =
  | "start_selection"
  | "task"
  | "band"
  | "scope"
  | "wishes_done"
  | "pick"
  | "leave_request"
  | "contact"
  | "skip_contact"
  | "district"
  | "term"
  | "ask_question"
  | "question"
  | "warranty_start"
  | "warranty_order"
  | "warranty_done"
  | "cancel";

type Rule = Partial<Record<StepEvent, Step | ((ctx: { scope?: string }) => Step)>>;

const SELECTION: readonly Step[] = ["sel_task", "sel_band", "sel_scope", "sel_wishes", "sel_result"];

const TABLE: Record<Step, Rule> = {
  idle: {
    start_selection: "sel_task",
    leave_request: "req_contact",
    ask_question: "report_question",
    warranty_start: "warranty_pick",
    warranty_order: "warranty_text",
  },
  sel_task: { task: "sel_band" },
  sel_band: { band: "sel_scope" },
  sel_scope: { scope: (ctx) => (ctx.scope === "setup" ? "req_contact" : "sel_wishes") },
  sel_wishes: { wishes_done: "sel_result" },
  sel_result: { pick: "req_contact", leave_request: "req_contact" },
  req_contact: { contact: "req_district", skip_contact: "req_district" },
  req_district: { district: "req_term" },
  req_term: { term: "idle" },
  report_question: { question: "idle" },
  warranty_pick: { warranty_order: "warranty_text" },
  warranty_text: { warranty_done: "idle" },
};

/** The step after `event`, or null when the event does not belong to `step`. */
export function advance(step: Step, event: StepEvent, ctx: { scope?: string } = {}): Step | null {
  if (!Object.hasOwn(TABLE, step)) return null;
  if (event === "cancel") return "idle";
  if (event === "start_selection" && SELECTION.includes(step)) return "sel_task";
  const rule = TABLE[step];
  if (!Object.hasOwn(rule, event)) return null;
  const next = rule[event];
  if (next === undefined) return null;
  return typeof next === "function" ? next(ctx) : next;
}
