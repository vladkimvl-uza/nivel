// The topics of the owner's group (ARCHITECTURE 7.2 «Группа владельца»): every new request gets a topic named
// "L-2026-0007 · Chilonzor · ПК 15 млн" with the card of the request and the buttons of the owner. The topic is made
// by the bot because only the bot may write it into the request (the worker has no right to the table of requests);
// a request of the site gets its topic from the sweep.
import { botTranslator, keyboardMarkup, renderOutboxMessage } from "@nivel/telegram";
import type { Api } from "grammy";
import { ownerGroupId } from "./config.ts";
import type { BotDeps } from "./deps.ts";
import { getLead, leadsWithoutTopic, setLeadTopic } from "./store.ts";

/** Telegram allows up to 128 characters in the name of a topic. */
const MAX_TOPIC_NAME = 128;

/**
 * Makes the topic and posts the card. Returns the id of the topic, or null when there is no group in the settings or
 * the request already has a topic. A refusal of Telegram throws: the caller decides whether the request can wait.
 */
export async function openLeadTopic(api: Api, deps: BotDeps, leadId: string): Promise<number | null> {
  const groupId = await ownerGroupId(deps.db);
  if (groupId === null) return null;
  const lead = await getLead(deps.db, leadId);
  if (lead === null || lead.tgTopicId !== null) return null;
  const t = botTranslator("ru");
  const name = t("owner.topic.title", {
    number: lead.number,
    district: lead.district ?? t("lead.created_empty"),
    scope: t.has(`owner.scope_short.${lead.scope}`) ? t(`owner.scope_short.${lead.scope}`) : lead.scope,
    budget:
      lead.budgetBand !== null && t.has(`owner.band_short.${lead.budgetBand}`)
        ? t(`owner.band_short.${lead.budgetBand}`)
        : "",
  });
  const topic = await api.createForumTopic(groupId, name.trim().slice(0, MAX_TOPIC_NAME));
  if (!(await setLeadTopic(deps.db, lead.id, topic.message_thread_id))) return topic.message_thread_id;
  const card = renderOutboxMessage({
    target: "owner_topic",
    templateKey: "lead.created",
    leadId: lead.id,
    params: {
      number: lead.number,
      scope: lead.scope,
      ...(lead.district === null ? {} : { district: lead.district }),
      ...(lead.budgetBand === null ? {} : { budgetBand: lead.budgetBand }),
    },
  });
  const markup = keyboardMarkup(card.buttons);
  await api.sendMessage(groupId, card.text, {
    message_thread_id: topic.message_thread_id,
    ...(markup === undefined ? {} : { reply_markup: markup }),
  });
  return topic.message_thread_id;
}

/** Makes the topics that are missing (requests of the site, a topic that could not be made at the time). */
export async function sweepLeadTopics(api: Api, deps: BotDeps): Promise<number> {
  let made = 0;
  for (const { id } of await leadsWithoutTopic(deps.db)) {
    try {
      if ((await openLeadTopic(api, deps, id)) !== null) made += 1;
    } catch (err) {
      deps.log.warn({ err, leadId: id }, "the topic of a request could not be made; the next sweep tries again");
    }
  }
  return made;
}
