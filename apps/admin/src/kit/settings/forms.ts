// The forms of the settings: which fields, in Russian, and how a submitted form becomes the stored value. Money and
// thresholds are drawn from their schemas; the calendar and the flags are small enough to be written by hand, because a
// work week is seven boxes and a holiday list is a column of dates, not what a schema walk would make of them.
import type { FieldSource } from "../form.ts";
import { describeSchema, type FieldNode } from "../schema.ts";
import { FEATURE_FLAGS, FeeSettingsSchema, parseHolidays, ThresholdSettingsSchema } from "./schemas.ts";

export const FEE_ROOT = describeSchema(FeeSettingsSchema.omit({ version: true }));
export const THRESHOLD_ROOT = describeSchema(ThresholdSettingsSchema);

export const SETTINGS_LABELS: Record<string, string> = {
  // fee scale
  effectiveFrom: "Дата вступления в силу",
  pcLowRateBp: "Ставка ПК до порога, б. п.",
  pcHighRateBp: "Ставка ПК выше порога, б. п.",
  pcThreshold: "Порог ставки ПК, сум",
  pcHighMinFee: "Минимальная плата выше порога, сум",
  mountRateBp: "Ставка монтажа, б. п.",
  complexRateBp: "Ставка сложной сборки, б. п.",
  minFullCyclePc: "Минимальная смета ПК (полный цикл), сум",
  minFreeWindowPc: "Минимальная смета ПК (свободное окно), сум",
  minFullCycleSetup: "Минимальная смета сетапа (полный цикл), сум",
  stageSharesBp: "Доли платы по этапам, б. п. (вместе 10 000)",
  "stageSharesBp.selection": "Подбор",
  "stageSharesBp.purchase": "Закупка",
  "stageSharesBp.assembly": "Сборка",
  "stageSharesBp.handover": "Сдача",
  commissionLineStages: "Этапы, входящие в строку «вознаграждение за закупку»",
  advanceBp: "Аванс при акцепте, б. п.",
  reserveBp: "Резерв гарантии, б. п.",
  reserveHighBp: "Повышенный резерв, б. п.",
  reserveHighShareBp: "Доля ОЗУ и SSD, с которой резерв повышается, б. п.",
  reserveRoundStep: "Шаг округления резерва вверх, сум",
  podborShareBp: "Доля платы за подбор, б. п.",
  podborCreditDays: "Срок зачёта подбора, дней",
  afterTestsRetainBp: "Удержание после тестов, б. п.",
  shelfLifeHours: "Срок действия сметы, часы",
  "shelfLifeHours.components": "Комплектующие",
  "shelfLifeHours.furniture": "Мебель",
  // thresholds
  annualLimit: "Годовой лимит оборота, сум",
  registrationDate: "Дата регистрации ИП",
  planCap: "Плановый потолок, сум",
  alertsBp: "Пороги оповещений, б. п. (по возрастанию)",
  proportion: "Лимит в год регистрации",
  // calendar
  workdays: "Рабочие дни",
  from: "Часы ответа: с",
  to: "Часы ответа: до",
  holidays: "Праздничные и нерабочие дни",
};

export const SETTINGS_OPTION_LABELS: Record<string, Record<string, string>> = {
  commissionLineStages: { selection: "Подбор", purchase: "Закупка", assembly: "Сборка", handover: "Сдача" },
  proportion: {
    without_registration_day: "без дня регистрации (нижняя граница)",
    with_registration_day: "с днём регистрации",
  },
  workdays: { "1": "Пн", "2": "Вт", "3": "Ср", "4": "Чт", "5": "Пт", "6": "Сб", "7": "Вс" },
};

// ---- calendar -------------------------------------------------------------------------------------------------------

const node = (n: Partial<FieldNode> & Pick<FieldNode, "kind" | "key">): FieldNode => ({
  path: [n.key],
  optional: false,
  nullable: false,
  ...n,
});

export const CALENDAR_FIELDS: FieldNode[] = [
  node({
    kind: "multiselect",
    key: "workdays",
    options: ["1", "2", "3", "4", "5", "6", "7"].map((value) => ({ value, label: value })),
    item: node({ kind: "select", key: "*", numericOptions: true }),
  }),
  node({ kind: "text", key: "from", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" }),
  node({ kind: "text", key: "to", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$" }),
  node({ kind: "longtext", key: "holidays" }),
];

export interface CalendarValue {
  tz: "Asia/Tashkent";
  workdays: number[];
  from: string;
  to: string;
  holidays: string[];
}

export function calendarToValues(c: CalendarValue): Record<string, unknown> {
  return { workdays: c.workdays, from: c.from, to: c.to, holidays: c.holidays.join("\n") };
}

export function calendarFromForm(source: FieldSource): { value: unknown; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const days = source
    .getAll("workdays")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7);
  const holidays = parseHolidays(source.get("holidays") ?? "");
  if (!holidays.ok) errors.holidays = holidays.error;
  return {
    value: {
      tz: "Asia/Tashkent",
      workdays: days,
      from: (source.get("from") ?? "").trim(),
      to: (source.get("to") ?? "").trim(),
      holidays: holidays.ok ? holidays.dates : [],
    },
    errors,
  };
}

// ---- flags ------------------------------------------------------------------------------------------------------------

const FLAG_KEYS = FEATURE_FLAGS.map((f) => f.slice("feature.".length));

export const FLAG_LABELS: Record<string, string> = {
  ai: "ИИ-консультант (пилот)",
  setupConfigurator: "Конфигуратор сетапа",
  scene: "Сцена на прокрутке",
  miniApp: "Mini App в Telegram",
};

export const FLAG_FIELDS: FieldNode[] = FLAG_KEYS.map((key) => node({ kind: "boolean", key }));

export function flagsToValues(flags: Record<string, { value: boolean; version: number }>): Record<string, boolean> {
  return Object.fromEntries(FLAG_KEYS.map((key) => [key, flags[`feature.${key}`]?.value === true]));
}

export function flagsFromForm(source: FieldSource): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const key of FLAG_KEYS) {
    const raw = source.get(key);
    if (raw === "true" || raw === "false") out[`feature.${key}`] = raw === "true";
  }
  return out;
}
