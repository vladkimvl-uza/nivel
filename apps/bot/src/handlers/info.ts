// /support, /terms, /privacy, /stop (ARCHITECTURE 7.2 «Команды»). The words of the terms come from `content.policy_texts`,
// the single source of the terms for the bot, the site and the assistant; a text that is only a stub is marked as a draft.
import { bot as botRepo, content } from "@nivel/db/repos";
import { consents } from "@nivel/services";
import { Composer } from "grammy";
import type { BotContext } from "../context.ts";
import { ack, say } from "../ui.ts";
import { loadProfile } from "./profile.ts";
import { legalUrl } from "./start.ts";

/** The policies that make «the terms of work», in the order the customer reads them. */
const TERMS_TOPICS = ["fee", "payment", "returns", "warranty", "timelines", "delivery"] as const;

/** The time of the answer: the policy `response_hours` of the owner, else the default text. */
export async function responseText(ctx: BotContext): Promise<string> {
  const policy = await content.getPolicy(ctx.deps.db, "response_hours");
  return policy?.body[ctx.lang] ?? ctx.t("request.reply_default");
}

async function policyText(
  ctx: BotContext,
  topic: (typeof TERMS_TOPICS)[number] | "privacy_short",
): Promise<string | null> {
  const policy = await content.getPolicy(ctx.deps.db, topic);
  if (policy === null) return null;
  const body = policy.body[ctx.lang];
  return policy.status === "stub" ? `${body} ${ctx.t("legal.draft_note")}` : body;
}

export const info = new Composer<BotContext>();

const support = async (ctx: BotContext) => {
  await ack(ctx);
  return say(ctx, ctx.t("support.text", { reply: await responseText(ctx) }));
};
info.command("support", support);
info.callbackQuery("m:support", support);

info.command("terms", async (ctx) => {
  let shown = 0;
  for (const topic of TERMS_TOPICS) {
    const text = await policyText(ctx, topic);
    if (text !== null) {
      await say(ctx, text);
      shown += 1;
    }
  }
  if (shown === 0) await say(ctx, ctx.t("legal.terms_fallback"));
});

info.command("privacy", async (ctx) => {
  const text = (await policyText(ctx, "privacy_short")) ?? ctx.t("legal.privacy_fallback");
  return say(ctx, `${text}\n${legalUrl(ctx, "privacy")}`);
});

info.command("stop", async (ctx) => {
  const { customer } = await loadProfile(ctx);
  const from = ctx.from;
  if (from === undefined) return;
  const subscribed = (await botRepo.listSubscribers(ctx.deps.db, "marketing")).includes(from.id);
  await botRepo.unsubscribe(ctx.deps.db, from.id, "marketing", ctx.deps.now());
  // The withdrawal is a row of the journal of consents, written only when there was something to withdraw.
  if (subscribed && customer !== null) {
    await consents.record(
      { kind: "marketing", customerId: customer.id, granted: false, channel: "bot", lang: ctx.lang },
      ctx.deps.rt,
    );
  }
  return say(ctx, ctx.t("stop.done"));
});
