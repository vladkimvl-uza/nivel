"use server";

// The server action `submitLead` (BUILD_PLAN WP-16; ARCHITECTURE 5.1): the request form of the one-page site posts here. Every
// field is read again on the server (form.ts), the bots are dropped, the rate is limited, and the request goes to the services
// (`leads.create` under the role `web`) through the gateway; the outbox task `lead.created` makes the topic in the group of the
// owner (the bot, WP-13).
import { headers } from "next/headers";
import { leadDeps } from "./runtime.ts";
import { clientIp, processLeadForm } from "./submit.ts";
import type { LeadActionState } from "./types.ts";

export async function submitLead(_previous: LeadActionState, formData: FormData): Promise<LeadActionState> {
  // A server action is a public entry: its arguments come from the body of a request, whatever the types say.
  if (!(formData instanceof FormData)) return { status: "error", code: "invalid", fields: {}, values: {} };
  const h = await headers();
  return processLeadForm(formData, { ip: clientIp(h) }, leadDeps());
}
