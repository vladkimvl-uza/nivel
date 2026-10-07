// The texts the worker itself puts into Telegram: reminders, alerts of the threshold and of the self-check, the digest of
// errors, and the one customer message of the worker (the reminder 24 hours after the acceptance). The texts of the order
// automaton (order.accepted, order.report_sent, ...) belong to the bot (WP-13, packages/telegram); this renderer answers
// `null` for them and the relay composes it with the one of the bot.
//
// The owner reads the admin panel in Russian only, so the texts to the owner are Russian. The text to the customer has
// both languages; the Uzbek one is a draft until the translator has seen it (oʻ and gʻ are U+02BB, other apostrophes U+02BC).
// TODO(integrator): when the namespace `worker` is registered in packages/i18n, move these strings into
// messages/{uz,ru,meta}/worker.json; the key names stay the same.
import type { Lang, MessageRenderer } from "./runtime.ts";

type Params = Readonly<Record<string, unknown>>;

/** A whole sum with a space between the thousands: 210 958 904. */
export function formatSumText(value: number): string {
  return String(Math.trunc(value)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Basis points as percent without a floating point: 6000 is "60", 6234 is "62,34". */
export function formatBpText(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const rest = Math.abs(bp % 100);
  if (rest === 0) return String(whole);
  return `${whole},${String(rest).padStart(2, "0")}`;
}

const text = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : fallback;
const whole = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0);

const SCOPE: Record<string, string> = { pc: "ПК", pc_periph: "ПК и периферия", setup: "сетап", podbor: "подбор" };

const MISSING = {
  ru: { fee: "предоплата", funds: "деньги на закупку", both: "предоплата и деньги на закупку" },
  uz: {
    fee: "oldindan toʻlov",
    funds: "xarid uchun mablagʻ",
    both: "oldindan toʻlov va xarid uchun mablagʻ",
  },
} as const;

type Template = (p: Params, lang: Lang) => string;

const TEMPLATES: Record<string, Template> = {
  "order.accept_reminder": (p, lang) => {
    const kind = p.missing === "fee" || p.missing === "funds" ? p.missing : "both";
    const what = MISSING[lang][kind];
    return lang === "uz"
      ? `Buyurtma ${text(p.number)}: smeta qabul qilinganiga bir sutka boʻldi. Hali ${what} kelmadi. Toʻlov boʻyicha savol boʻlsa, shu yerga yozing.`
      : `Заказ ${text(p.number)}: со дня принятия сметы прошли сутки. Мы ещё не получили: ${what}. Если нужна помощь с оплатой, напишите сюда.`;
  },

  "lead.created": (p) => {
    const parts = [SCOPE[text(p.scope)] ?? "заявка"];
    if (text(p.district) !== "") parts.push(text(p.district));
    if (text(p.budgetBand) !== "") parts.push(`бюджет ${text(p.budgetBand)}`);
    return `Новая заявка ${text(p.number)}: ${parts.join(", ")}`;
  },

  "reminder.lead_no_answer": (p) =>
    `Заявка ${text(p.number)} без ответа ${whole(p.minutes)} мин. Ответьте клиенту в теме заявки.`,

  "reminder.report_due": (p) =>
    p.last === true
      ? `Заказ ${text(p.number)}: крайний срок отчёта по закупке (48 часов). Отправьте отчёт клиенту сейчас.`
      : `Заказ ${text(p.number)}: пора отправить клиенту отчёт по закупке (цель — 24 часа).`,

  "reminder.refund_due": (p) =>
    `Заказ ${text(p.number)}: подошёл срок возврата остатка. Проверьте перевод и подтвердите его.`,

  "reminder.aftercare": (p) => `Заказ ${text(p.number)}: через ${whole(p.days)} дн. после сдачи — позвоните клиенту.`,

  "threshold.alert": (p) => {
    const level = whole(p.levelBp);
    const lines = [
      `Порог регистрации плательщика НДС, ${whole(p.year)} год: набрано ${formatBpText(level)} % годового лимита.`,
      `Сейчас ${formatBpText(whole(p.shareBp))} %: ${formatSumText(whole(p.volume))} из ${formatSumText(whole(p.limit))} сум.`,
    ];
    if (level >= 10_000)
      lines.push("Лимит достигнут: нужна регистрация плательщика НДС, обратитесь к бухгалтеру сегодня.");
    else if (level >= 7000) lines.push("Подключите бухгалтера уровня 2 и проверьте план сделок до конца года.");
    return lines.join("\n");
  },

  "threshold.plan": (p) =>
    `Порог, ${whole(p.year)} год: прогноз выше плана ${formatSumText(whole(p.planCap))} сум (${formatBpText(whole(p.projectedShareBp))} % лимита к концу года).`,

  "ops.job_failed": (p) =>
    `Задача ${text(p.queue)} упала ${whole(p.attempts)} раз подряд (всего таких сбоев: ${whole(p.count)}). ${text(p.message)}`,

  "ops.alert": (p) => {
    const names: Record<string, string> = {
      backup_age: "Резервная копия устарела",
      disk: "Диск заполнен",
      certificate: "Сертификат скоро кончится",
      queue_stalled: "Очередь задач стоит",
      outbox_stalled: "Исходящие сообщения не уходят",
      webhook: "Ошибка вебхука Telegram",
    };
    return `${names[text(p.check)] ?? `Проверка ${text(p.check)} не пройдена`}: ${text(p.detail)}`;
  },

  "ops.digest": (p) => {
    const items = Array.isArray(p.items) ? (p.items as Params[]) : [];
    const lines = items.map((i) => `${text(i.queue)} ×${whole(i.count)}: ${text(i.message)}`);
    return ["Ошибки за сутки:", ...lines].join("\n");
  },
};

/** The renderer of the texts of the worker. */
export const workerRenderer: MessageRenderer = {
  render(templateKey, lang, params) {
    const template = TEMPLATES[templateKey];
    return template === undefined ? null : template(params, lang);
  },
};

/** Tries the renderers in order: the first that knows the key wins (the bot's templates first, then the worker's own). */
export function composeRenderers(list: readonly MessageRenderer[]): MessageRenderer {
  return {
    render(templateKey, lang, params) {
      for (const renderer of list) {
        const out = renderer.render(templateKey, lang, params);
        if (out !== null) return out;
      }
      return null;
    },
  };
}
