// The common frame of the server actions of the orders screens: who is asking, the work, the journal of a refusal, the
// answer. Every action goes through here, so that none of them forgets the session or the journal of a refused attempt.
import { revalidatePath } from "next/cache";
import { currentUser, requestInfo } from "../auth/next.ts";
import { getRuntime } from "../auth/runtime.ts";
import type { SessionUser } from "../auth/service.ts";
import type { ActionState } from "./action-state.ts";
import type { Outcome } from "./commands.ts";
import { SERVICE_FALLBACK } from "./messages.ts";

export interface RunSpec {
  /** Journal name of the action, `orders.pay_confirm`: a refused attempt is written as `<name>.denied`. */
  name: string;
  entity: string;
  entityId?: string | null;
  /** Pages that show what the action changed. */
  revalidate: string[];
}

export const SESSION_ENDED = "Сеанс закончился: войдите в админку заново.";

export async function runAction(
  spec: RunSpec,
  work: (user: SessionUser, ipHash: string | null) => Promise<Outcome>,
): Promise<ActionState> {
  const user = await currentUser();
  if (!user) return { ok: false, message: SESSION_ENDED, at: Date.now() };
  const { ipHash } = await requestInfo();
  let outcome: Outcome;
  try {
    outcome = await work(user, ipHash);
  } catch (error) {
    // Anything the command did not turn into text: the person sees the general text, the journal of the server has the rest.
    console.error(`[orders] ${spec.name} failed:`, error);
    return { ok: false, message: SERVICE_FALLBACK, at: Date.now() };
  }
  if (!outcome.ok && outcome.denied) {
    await getRuntime().audit.append({
      actor: `admin:${user.id}`,
      action: `${spec.name}.denied`,
      entity: spec.entity,
      entityId: spec.entityId ?? null,
      after: { role: user.role },
      ipHash,
    });
  }
  if (outcome.ok) for (const path of spec.revalidate) revalidatePath(path);
  return { ok: outcome.ok, message: outcome.message, at: Date.now() };
}
