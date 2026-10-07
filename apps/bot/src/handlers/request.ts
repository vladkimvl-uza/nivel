// The request (ARCHITECTURE 7.2 «Заявка»): the contact (optional), the district (not the address), the term, then
// `services.leads.create`. The consent was given before any of it. At most three requests a day (by the day of the
// database); the owner gets a topic in his group, and the customer gets the number and the time of the answer.
import { content } from "@nivel/db/repos";
import { isoDateInTashkent } from "@nivel/domain/calendar";
import { leads } from "@nivel/services";
import { botTranslator, decodeCallback, encodeCallback } from "@nivel/telegram";
import { Composer } from "grammy";
import type { BotContext } from "../context.ts";
import { BAND_BUDGET_SUM, isBand, isScope, isTask } from "../showcase.ts";
import { advance } from "../steps.ts";
import { countLeadsToday, setCustomerContact } from "../store.ts";
import { openLeadTopic } from "../topics.ts";
import { ack, button, say } from "../ui.ts";
import { loadProfile } from "./profile.ts";

export const DAILY_LEAD_LIMIT = 3;
const MAX_DISTRICT = 80;
const TERM_DAYS = { asap: 3, week: 7, month: 30 } as const;
const E164 = /^\+[1-9][0-9]{7,14}$/;

/** Asks for the contact with the button of Telegram that shares the phone of the person; the phone is optional. */
export function askContact(ctx: BotContext) {
  return ctx.reply(ctx.t("request.contact_ask"), {
    reply_markup: {
      keyboard: [
        [{ text: ctx.t("request.contact_button"), request_contact: true }],
        [{ text: ctx.t("request.contact_skip") }],
      ],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
}

const askDistrict = (ctx: BotContext) =>
  ctx.reply(ctx.t("request.district_ask"), { reply_markup: { remove_keyboard: true } });

function askTerm(ctx: BotContext) {
  return say(
    ctx,
    ctx.t("request.term_ask"),
    (["asap", "week", "month", "later"] as const).map((term) => [
      button(ctx.t(`request.term.${term}`), encodeCallback("ld", ["term", term])),
    ]),
  );
}

/** Is `text` the label of the «skip» button in either language (the customer may have changed the language). */
const isSkip = (text: string) => (["uz", "ru"] as const).some((l) => botTranslator(l)("request.contact_skip") === text);

/** The comment of the request for the owner: Russian, whatever the language of the customer. */
function commentOf(ctx: BotContext): string | undefined {
  const { task, band, scope, wishes, build } = ctx.session.draft;
  if (!isTask(task) || !isBand(band) || !isScope(scope)) return undefined;
  const ru = botTranslator("ru");
  const wishText =
    wishes.length === 0 ? ru("request.wishes_none") : wishes.map((x) => ru(`select.wishes.${x}`)).join(", ");
  const head = ru("request.comment", {
    task: ru(`select.task.${task}`),
    band: ru(`select.band.${band}`),
    scope: ru(`select.scope.${scope}`),
    wishes: wishText,
  });
  if (build === undefined) return head;
  const title = ru("select.result.title", { task: ru(`select.task.${build.task}`), tier: Number(build.tier.slice(1)) });
  return `${head}\n${title} (${build.style})`;
}

async function responseText(ctx: BotContext): Promise<string> {
  const policy = await content.getPolicy(ctx.deps.db, "response_hours");
  return policy?.body[ctx.lang] ?? ctx.t("request.reply_default");
}

async function createLead(ctx: BotContext, term: keyof typeof TERM_DAYS | "later") {
  const { customer } = await loadProfile(ctx);
  if (customer === null) return say(ctx, ctx.t("request.failed"));
  if ((await countLeadsToday(ctx.deps.db, customer.id)) >= DAILY_LEAD_LIMIT) {
    ctx.session.step = "idle";
    ctx.session.draft = { wishes: [] };
    return say(ctx, ctx.t("request.limit"));
  }
  const draft = ctx.session.draft;
  const comment = commentOf(ctx);
  const wantedBy =
    term === "later" ? undefined : isoDateInTashkent(new Date(ctx.deps.now().getTime() + TERM_DAYS[term] * 86_400_000));
  let created: { leadId: string; number: string };
  try {
    created = await leads.create(
      {
        channel: "bot",
        scope: isScope(draft.scope) ? draft.scope : "pc",
        lang: ctx.lang,
        customerId: customer.id,
        ...(draft.district === undefined ? {} : { district: draft.district }),
        ...(wantedBy === undefined ? {} : { wantedBy }),
        ...(isBand(draft.band) ? { budgetSum: BAND_BUDGET_SUM[draft.band] } : {}),
        ...(comment === undefined ? {} : { comment }),
      },
      ctx.deps.rt,
    );
  } catch (err) {
    ctx.deps.log.error({ err }, "leads.create failed");
    return say(ctx, ctx.t("request.failed"));
  }
  await setCustomerContact(ctx.deps.db, customer.id, { phone: draft.phone, district: draft.district });
  ctx.session.step = "idle";
  ctx.session.draft = { wishes: [] };
  await ctx.reply(ctx.t("request.created", { number: created.number, reply: await responseText(ctx) }), {
    reply_markup: { remove_keyboard: true },
  });
  try {
    await openLeadTopic(ctx.api, ctx.deps, created.leadId);
  } catch (err) {
    // The request is saved and the customer has his number; the sweep makes the topic when Telegram allows.
    ctx.deps.log.warn({ err, leadId: created.leadId }, "the topic of the request could not be made");
  }
}

export const request = new Composer<BotContext>();

request.on("message", async (ctx, next) => {
  const step = ctx.session.step;
  // A command is a command at every step (/start and /language were taken before): the step stays where it was.
  if (ctx.message.entities?.some((e) => e.type === "bot_command" && e.offset === 0) === true) return next();
  if (step === "req_contact") {
    const contact = ctx.message.contact;
    if (contact !== undefined) {
      // Only the own contact: the button of Telegram sends it with the user id of the sender.
      if (contact.user_id !== ctx.from.id) return askContact(ctx);
      const phone = `+${contact.phone_number.replace(/\D/g, "")}`;
      if (E164.test(phone)) ctx.session.draft.phone = phone;
    } else if (ctx.message.text === undefined || !isSkip(ctx.message.text)) {
      return askContact(ctx);
    }
    ctx.session.step = advance(step, contact === undefined ? "skip_contact" : "contact") ?? step;
    return askDistrict(ctx);
  }
  if (step === "req_district") {
    const text = ctx.message.text?.trim();
    if (
      text === undefined ||
      text === "" ||
      text.length > MAX_DISTRICT ||
      text.includes("\n") ||
      text.startsWith("/")
    ) {
      return ctx.reply(ctx.t("request.district_invalid"));
    }
    ctx.session.draft.district = text;
    ctx.session.step = advance(step, "district") ?? step;
    return askTerm(ctx);
  }
  return next();
});

request.callbackQuery(/^ld:/, async (ctx) => {
  const data = decodeCallback(ctx.callbackQuery.data);
  const term = data?.args[1];
  if (data?.args[0] !== "term" || (term !== "asap" && term !== "week" && term !== "month" && term !== "later")) {
    return ack(ctx);
  }
  if (advance(ctx.session.step, "term") === null) return ack(ctx, ctx.t("common.stale"));
  await ack(ctx);
  return createLead(ctx, term);
});
