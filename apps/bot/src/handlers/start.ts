// /start, /language, the consent and the menu (ARCHITECTURE 7.2: «Старт и язык», «Согласие»). The language is the choice
// of the person, kept in the profile; `language_code` of Telegram is not relied upon. Without the consent no contact is
// asked and nothing else is done.
import { content } from "@nivel/db/repos";
import type { AppLocale } from "@nivel/i18n";
import { consents } from "@nivel/services";
import { botTranslator, decodeCallback, encodeCallback } from "@nivel/telegram";
import { Composer } from "grammy";
import type { BotContext } from "../context.ts";
import { ensureCustomer, hasProcessingConsent, setCustomerLang } from "../store.ts";
import { ack, button, clearButtons, say } from "../ui.ts";
import { loadProfile } from "./profile.ts";

export const MENU_ACTIONS = ["select", "order", "support", "warranty"] as const;

const useLang = (ctx: BotContext, lang: AppLocale) => {
  ctx.session.lang = lang;
  ctx.lang = lang;
  ctx.t = botTranslator(lang);
};

export function languageRows() {
  const t = botTranslator("uz");
  return [
    [
      button(t("start.language_uz"), encodeCallback("lg", ["uz"])),
      button(t("start.language_ru"), encodeCallback("lg", ["ru"])),
    ],
  ];
}

export const askLanguage = (ctx: BotContext) => say(ctx, botTranslator("uz")("start.choose_language"), languageRows());

export function menu(ctx: BotContext) {
  const t = ctx.t;
  return say(ctx, t("menu.title"), [
    [button(t("menu.select"), encodeCallback("m", ["select"]))],
    [button(t("menu.order"), encodeCallback("m", ["order"]))],
    [button(t("menu.support"), encodeCallback("m", ["support"]))],
    [button(t("menu.warranty"), encodeCallback("m", ["warranty"]))],
  ]);
}

/** The link to a document of the site (the path /<lang>/legal/<kind> is the site's). */
export const legalUrl = (ctx: BotContext, kind: "privacy" | "terms"): string =>
  `${ctx.deps.publicBaseUrl.replace(/\/+$/, "")}/${ctx.lang}/legal/${kind}`;

export async function showConsent(ctx: BotContext, headline?: string) {
  const doc = await content.getPublishedLegalDocument(ctx.deps.db, "consent_pd", ctx.lang);
  const notice = ctx.t("start.consent", { version: doc?.version ?? "—", url: legalUrl(ctx, "privacy") });
  return say(ctx, headline === undefined ? notice : `${headline}\n\n${notice}`, [
    [button(ctx.t("start.consent_button"), encodeCallback("cn", ["ok"]))],
  ]);
}

/** What /start shows: the language, then the consent, then the menu. */
async function entry(ctx: BotContext) {
  const profile = await loadProfile(ctx);
  if (ctx.session.lang === undefined) return askLanguage(ctx);
  useLang(ctx, ctx.session.lang);
  if (!profile.consented) return showConsent(ctx);
  return menu(ctx);
}

export const start = new Composer<BotContext>();

start.command("start", async (ctx) => {
  ctx.session.step = "idle";
  await entry(ctx);
});

start.command("language", (ctx) => askLanguage(ctx));

start.callbackQuery(/^lg:/, async (ctx) => {
  const data = decodeCallback(ctx.callbackQuery.data);
  const lang = data?.args[0];
  if (data === null || (lang !== "uz" && lang !== "ru")) return ack(ctx);
  await ack(ctx);
  useLang(ctx, lang);
  const profile = await loadProfile(ctx);
  if (profile.customer !== null) await setCustomerLang(ctx.deps.db, profile.customer.id, lang);
  if (!profile.consented) return showConsent(ctx);
  await say(ctx, ctx.t("start.language_saved"));
  return menu(ctx);
});

start.callbackQuery("cn:ok", async (ctx) => {
  if (ctx.session.lang === undefined) {
    await ack(ctx);
    return askLanguage(ctx);
  }
  useLang(ctx, ctx.session.lang);
  const from = ctx.from;
  const name = [from.first_name, from.last_name].filter(Boolean).join(" ").trim();
  const customer = await ensureCustomer(ctx.deps.db, {
    telegramUserId: from.id,
    displayName: name === "" ? null : name.slice(0, 120),
    telegramUsername: from.username === undefined ? null : from.username.slice(0, 64),
    lang: ctx.lang,
  });
  if (!(await hasProcessingConsent(ctx.deps.db, customer.id))) {
    const doc = await content.getPublishedLegalDocument(ctx.deps.db, "consent_pd", ctx.lang);
    await consents.record(
      {
        kind: "pd_processing",
        customerId: customer.id,
        granted: true,
        channel: "bot",
        lang: ctx.lang,
        ...(doc === null ? {} : { documentId: doc.id }),
        evidence: { messageId: ctx.callbackQuery.message?.message_id ?? 0, telegramUserId: from.id },
      },
      ctx.deps.rt,
    );
  }
  ctx.session.consented = true;
  await ack(ctx, ctx.t("start.consent_recorded"));
  await clearButtons(ctx);
  await say(ctx, ctx.t("start.welcome"));
  return menu(ctx);
});
