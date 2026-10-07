// The topics of the owner's group (ARCHITECTURE 7.2 «Группа владельца»): every new request gets a topic named
// "L-2026-0007 · Chilonzor · ПК 15 млн" with the card of the request and the buttons of the owner. The topic is made
// by the bot because only the bot may write it into the request (the worker has no right to the table of requests);
// a request of the site gets its topic from the sweep.
import { botTranslator, keyboardMarkup, renderOutboxMessage } from "@nivel/telegram";
import { type Api, GrammyError } from "grammy";
import { ownerGroupId } from "./config.ts";
import type { BotDeps } from "./deps.ts";
import { forgetTopic, getLead, leadsWithoutTopic, setLeadTopic } from "./store.ts";

/** Telegram allows up to 128 characters in the name of a topic. */
const MAX_TOPIC_NAME = 128;

/** The requests whose topic is being made now: a second maker (the sweep) waits for the first instead of making its own. */
const making = new Map<string, Promise<number | null>>();

/**
 * Makes the topic and posts the card. Returns the id of the topic, or null when there is no group in the settings, the
 * request already has a topic, or another maker was first. A refusal of Telegram throws: the caller decides whether the
 * request can wait (the sweep tries again, and a topic without its card is taken back so that it is made again).
 */
export function openLeadTopic(api: Api, deps: BotDeps, leadId: string): Promise<number | null> {
  const running = making.get(leadId);
  if (running !== undefined) return running.then(() => null);
  const job = makeLeadTopic(api, deps, leadId).finally(() => making.delete(leadId));
  making.set(leadId, job);
  return job;
}

async function makeLeadTopic(api: Api, deps: BotDeps, leadId: string): Promise<number | null> {
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
  const thread = topic.message_thread_id;
  if (!(await setLeadTopic(deps.db, lead.id, thread))) {
    // Somebody else gave the request its topic while this one was made: this one stays empty, so it is not left.
    await dropTopic(api, deps, groupId, thread);
    return null;
  }
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
  try {
    await api.sendMessage(groupId, card.text, {
      message_thread_id: thread,
      ...(markup === undefined ? {} : { reply_markup: markup }),
    });
  } catch (err) {
    // A topic without its card is of no use to the owner and the sweep would not look at it again: take it back.
    await forgetTopic(deps.db, thread);
    await dropTopic(api, deps, groupId, thread);
    throw err;
  }
  return thread;
}

async function dropTopic(api: Api, deps: BotDeps, groupId: number, thread: number): Promise<void> {
  try {
    await api.deleteForumTopic(groupId, thread);
  } catch (err) {
    deps.log.warn({ err, thread }, "an unneeded topic could not be deleted");
  }
}

/** Telegram says the topic is gone (the owner deleted it). */
export const isDeadTopic = (err: unknown): boolean =>
  err instanceof GrammyError &&
  err.error_code === 400 &&
  /message thread not found|TOPIC_DELETED|TOPIC_ID_INVALID/i.test(err.description);

/**
 * Puts something into a topic of the owner's group. A topic the owner deleted is made again for its request (the old id
 * is forgotten, the card is posted) and the sending is tried once more there. False when it could not be delivered.
 * Other refusals of Telegram are thrown to the caller.
 */
export async function sendToTopic(
  api: Api,
  deps: BotDeps,
  thread: number,
  send: (thread: number) => Promise<unknown>,
): Promise<boolean> {
  try {
    await send(thread);
    return true;
  } catch (err) {
    if (!isDeadTopic(err)) throw err;
  }
  deps.log.warn({ thread }, "the topic is gone from the group: making it again");
  const requests = await forgetTopic(deps.db, thread);
  for (const id of requests) {
    let fresh: number | null;
    try {
      fresh = await openLeadTopic(api, deps, id);
    } catch (err) {
      deps.log.warn({ err, leadId: id }, "the topic could not be made again");
      continue;
    }
    if (fresh === null) continue;
    try {
      await send(fresh);
      return true;
    } catch (err) {
      deps.log.warn({ err, thread: fresh }, "nothing could be put into the new topic either");
      return false;
    }
  }
  return false;
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
