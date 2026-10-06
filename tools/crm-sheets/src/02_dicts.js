/**
 * Dictionaries: codes of the domain <-> Russian labels. The "Справочники" sheet is built from these tables;
 * formulas refer to the named ranges NVD_* made over its columns. Codes are Latin and fixed; labels can be edited.
 */

/** The 17 statuses of the order automaton (packages/domain order/types.ts) with the projection for the customer. */
const NV_STATUSES = [
  // code, label, customer code, customer label, group, stage of the dashboard, key of the stage-date column, tone
  ["estimate_draft", "Смета: черновик", "submitted", "Смета", "Смета", "Смета", "", "s1"],
  ["estimate_sent", "Смета отправлена", "submitted", "Смета", "Ждёт клиента", "Смета", "dEstimate", "s1"],
  ["estimate_expired", "Смета истекла", "submitted", "Смета", "Смета", "Смета", "", "cancelled"],
  [
    "accepted",
    "Принят: ждём оплату",
    "estimate_confirmed",
    "Ждём предоплату",
    "Ждёт клиента",
    "Ждёт оплаты",
    "dAccepted",
    "s2",
  ],
  ["purchasing", "Закупка", "purchasing", "Закупка", "В работе", "Закупка", "dPurchase", "s3"],
  ["report_due", "Готовим отчёт", "purchasing", "Закупка", "В работе", "Закупка", "dPurchaseDone", "s3"],
  ["report_sent", "Отчёт отправлен", "receipts_summary", "Итог по чекам", "Ждёт клиента", "Отчёт", "reportSent", "s4"],
  ["settled", "Сведён", "receipts_summary", "Итог по чекам", "В работе", "Отчёт", "dSettled", "s4"],
  ["assembling", "Сборка", "assembly_test", "Сборка и тест", "В работе", "Сборка и тест", "dAssembly", "s5"],
  ["testing", "Тест 8 ч", "assembly_test", "Сборка и тест", "В работе", "Сборка и тест", "dTest", "s5"],
  ["ready", "Готов к выдаче", "ready", "Готово к выдаче", "В работе", "Готов и доставка", "dReady", "s6"],
  ["delivering", "Доставка", "ready", "Готово к выдаче", "В работе", "Готов и доставка", "dDelivery", "s6"],
  ["handed_over", "Сдан", "handed_over", "Сдано", "Сдан", "Сдан", "dHandover", "s7"],
  ["closed", "Закрыт", "handed_over", "Сдано", "Сдан", "Сдан", "dClosed", "archive"],
  ["podbor_delivered", "Подбор сдан", "handed_over", "Сдано", "Сдан", "Сдан", "dPodbor", "s7"],
  ["cancelling", "Отмена: расчёт", "cancelled", "Отменён", "Отмена", "Отмена", "dCancelStart", "cancelling"],
  ["cancelled", "Отменён", "cancelled", "Отменён", "Отмена", "Отмена", "dCancelled", "cancelled"],
].map((r, i) => ({
  code: r[0],
  label: r[1],
  clientCode: r[2],
  clientLabel: r[3],
  group: r[4],
  stage: r[5],
  dateKey: r[6],
  tone: r[7],
  order: i + 1,
}));

/** Stage buckets of the "Заказы по этапам сейчас" chart, in the order of the automaton. */
const NV_STAGES = ["Смета", "Ждёт оплаты", "Закупка", "Отчёт", "Сборка и тест", "Готов и доставка"];

/** Events of the order automaton: code, label, whether the owner may pick it in the dropdown, and who sends it in the domain. */
const NV_EVENTS = [
  ["SEND_ESTIMATE", "Отправить смету", true, "owner"],
  ["EXPIRE", "Срок сметы истёк", false, "system"],
  ["REVISE", "Пересмотреть смету", true, "owner"],
  ["ACCEPT", "Клиент принял", true, "customer"],
  ["FEE_PREPAID", "Аванс получен", true, "owner"],
  ["FUNDS_RECEIVED", "Деньги на закупку получены", true, "owner"],
  ["MEETING_DONE", "Встреча проведена", true, "owner"],
  ["START_PURCHASE", "Начать закупку", true, "owner"],
  ["PURCHASE_RECORDED", "Чек записан", true, "owner,assistant"],
  ["PURCHASE_DONE", "Закупка завершена", true, "owner"],
  ["SEND_REPORT", "Отчёт отправлен", true, "owner"],
  ["OBJECTION", "Возражение клиента", true, "customer"],
  ["REPORT_ACCEPTED", "Отчёт принят клиентом", true, "customer"],
  ["REPORT_DEEMED_ACCEPTED", "Отчёт принят по сроку", false, "system"],
  ["REMAINDER_SETTLED", "Остаток возвращён, сверено", true, "owner"],
  ["MATERIALS_ACCEPTED", "Акт приёма материала", true, "owner"],
  ["ASSEMBLED", "Собрано", true, "owner,assistant"],
  ["TESTS_PASSED", "Тест пройден, паспорт готов", true, "owner,assistant"],
  ["DISPATCH", "Отправлен клиенту", true, "owner"],
  ["HANDOVER", "Сдан по акту", true, "owner,customer"],
  ["CLOSE", "Закрыть", false, "system"],
  ["PODBOR_DELIVERED", "Подбор сдан", true, "owner"],
  ["CANCEL", "Отмена по заявлению клиента", true, "owner"],
  ["CANCEL_SETTLED", "Отмена рассчитана", true, "owner"],
].map((r) => ({ code: r[0], label: r[1], ui: r[2], actors: r[3].split(",") }));

/** Events the assistant must never send (money events). */
const NV_MONEY_EVENTS = [
  "FEE_PREPAID",
  "FUNDS_RECEIVED",
  "START_PURCHASE",
  "REMAINDER_SETTLED",
  "HANDOVER",
  "CANCEL",
  "CANCEL_SETTLED",
  "SEND_ESTIMATE",
];

/** Table of transitions (ARCHITECTURE 4.9): "from status" x event -> "to status". A test compares it with the domain. */
const NV_TRANSITIONS = (() => {
  const rows = [];
  const add = (from, event, to) =>
    from.forEach((f) => {
      rows.push({ from: f, event: event, to: to });
    });
  add(["estimate_draft"], "SEND_ESTIMATE", "estimate_sent");
  add(["estimate_sent"], "EXPIRE", "estimate_expired");
  add(["estimate_sent", "estimate_expired"], "REVISE", "estimate_draft");
  add(["estimate_sent"], "ACCEPT", "accepted");
  add(["accepted"], "FEE_PREPAID", "accepted");
  add(["accepted"], "FUNDS_RECEIVED", "accepted");
  add(["accepted"], "MEETING_DONE", "accepted");
  add(["accepted"], "START_PURCHASE", "purchasing");
  add(["purchasing"], "PURCHASE_RECORDED", "purchasing");
  add(["purchasing"], "PURCHASE_DONE", "report_due");
  add(["report_due"], "SEND_REPORT", "report_sent");
  add(["report_sent"], "OBJECTION", "report_sent");
  add(["report_sent"], "REPORT_ACCEPTED", "report_sent");
  add(["report_sent"], "REPORT_DEEMED_ACCEPTED", "report_sent");
  add(["report_sent"], "REMAINDER_SETTLED", "settled");
  add(["settled"], "MATERIALS_ACCEPTED", "assembling");
  add(["assembling"], "ASSEMBLED", "testing");
  add(["testing"], "TESTS_PASSED", "ready");
  add(["ready"], "DISPATCH", "delivering");
  add(["delivering"], "HANDOVER", "handed_over");
  add(["handed_over"], "CLOSE", "closed");
  add(["estimate_sent"], "PODBOR_DELIVERED", "podbor_delivered");
  const cancellable = [];
  NV_CANCEL_POINTS.forEach((p) => {
    for (const s of p.statuses) cancellable.push(s);
  });
  add(cancellable, "CANCEL", "cancelling");
  add(["cancelling"], "CANCEL_SETTLED", "cancelled");
  return rows;
})();

const NV_LEAD_STATUSES = [
  ["new", "Новая"],
  ["in_review", "В работе"],
  ["converted", "В заказе"],
  ["rejected", "Отказ"],
  ["spam", "Спам"],
].map((r) => ({ code: r[0], label: r[1] }));

/** Scope of a lead: code, label, kind of the order that follows. */
const NV_SCOPES = [
  ["pc", "ПК", "ПК"],
  ["pc_periph", "ПК и периферия", "ПК"],
  ["setup", "Сетап", "Сетап"],
  ["podbor", "Подбор", "Подбор"],
  ["upgrade", "Апгрейд", "Апгрейд"],
].map((r) => ({ code: r[0], label: r[1], kind: r[2] }));

const NV_KINDS = [
  ["pc", "ПК"],
  ["setup", "Сетап"],
  ["podbor", "Подбор"],
  ["upgrade", "Апгрейд"],
].map((r) => ({ code: r[0], label: r[1] }));

const NV_SLOTS = ["Обычный", "Свободное окно"];

const NV_BUDGET_BANDS = [
  ["lt5", "до 5 млн"],
  ["5-10", "5–10 млн"],
  ["10-20", "10–20 млн"],
  ["20-40", "20–40 млн"],
  ["40-60", "40–60 млн"],
  ["gt60", "от 60 млн"],
].map((r) => ({ code: r[0], label: r[1] }));

const NV_DISTRICTS = [
  "Алмазарский",
  "Бектемирский",
  "Мирабадский",
  "Мирзо-Улугбекский",
  "Сергелийский",
  "Учтепинский",
  "Чиланзарский",
  "Шайхантахурский",
  "Юнусабадский",
  "Яккасарайский",
  "Яшнабадский",
  "Янгихаётский",
  "Регион",
];

/** Channels (MARKETING 3.2): label, source code, paid. */
const NV_CHANNELS = [
  ["Telegram-бот", "bot", "нет"],
  ["Сайт", "site", "нет"],
  ["Instagram", "ig", "нет"],
  ["Telegram-канал", "tgchan", "нет"],
  ["Посев в Telegram", "seed", "да"],
  ["Реклама Telegram", "tgads", "да"],
  ["Instagram-реклама", "igads", "да"],
  ["Яндекс", "yandex", "да"],
  ["Google", "google", "да"],
  ["OLX", "olx", "нет"],
  ["Карты", "maps", "нет"],
  ["Рекомендация", "ref", "нет"],
  ["Партнёр", "partner", "нет"],
  ["Блогер", "blogger", "да"],
  ["Знакомые", "friends", "нет"],
  ["Другое", "other", "нет"],
].map((r) => ({ label: r[0], code: r[1], paid: r[2] }));

/** Channel codes of the platform events (lead.created "channel") -> label. */
const NV_CHANNEL_BY_PLATFORM = {
  bot: "Telegram-бот",
  site: "Сайт",
  instagram: "Instagram",
  ig: "Instagram",
  tgchan: "Telegram-канал",
  seed: "Посев в Telegram",
  tgads: "Реклама Telegram",
  igads: "Instagram-реклама",
  yandex: "Яндекс",
  google: "Google",
  olx: "OLX",
  maps: "Карты",
  ref: "Рекомендация",
  referral: "Рекомендация",
  partner: "Партнёр",
  blogger: "Блогер",
  friends: "Знакомые",
  other: "Другое",
};

const NV_REJECT_REASONS = [
  "Ниже минимальной сметы",
  "Регион",
  "Не отвечает",
  "Дорого",
  "Купил в магазине",
  "Сроки",
  "Работы без закупки",
  "Другое",
];

const NV_LANGS = ["uz", "ru"];

/** Warranty cases (ARCHITECTURE 4.10). */
const NV_WARRANTY_STATUSES = [
  ["opened", "Открыт"],
  ["diagnosing", "Диагностика"],
  ["loaner_issued", "Выдан подменный"],
  ["at_supplier", "У поставщика"],
  ["resolved", "Устранён"],
  ["rejected", "Отказ"],
  ["closed", "Закрыт"],
].map((r) => ({ code: r[0], label: r[1] }));

const NV_WARRANTY_EVENTS = [
  ["START_DIAGNOSIS", "Начать диагностику"],
  ["ISSUE_LOANER", "Выдать подменный"],
  ["SEND_TO_SUPPLIER", "Отправить поставщику"],
  ["RESOLVE", "Устранено"],
  ["REJECT", "Отказать: вина клиента"],
  ["CLOSE", "Закрыть"],
].map((r) => ({ code: r[0], label: r[1] }));

const NV_WARRANTY_TRANSITIONS = [
  ["opened", "START_DIAGNOSIS", "diagnosing"],
  ["diagnosing", "ISSUE_LOANER", "loaner_issued"],
  ["diagnosing", "SEND_TO_SUPPLIER", "at_supplier"],
  ["diagnosing", "RESOLVE", "resolved"],
  ["diagnosing", "REJECT", "rejected"],
  ["loaner_issued", "SEND_TO_SUPPLIER", "at_supplier"],
  ["loaner_issued", "RESOLVE", "resolved"],
  ["loaner_issued", "REJECT", "rejected"],
  ["at_supplier", "RESOLVE", "resolved"],
  ["at_supplier", "REJECT", "rejected"],
  ["resolved", "CLOSE", "closed"],
  ["rejected", "CLOSE", "closed"],
].map((r) => ({ from: r[0], event: r[1], to: r[2] }));

const NV_WARRANTY_FAULTS = [
  ["impact", "Удар"],
  ["liquid", "Жидкость"],
  ["overclocking", "Разгон"],
  ["third_party_replacement", "Замена не исполнителем"],
].map((r) => ({ code: r[0], label: r[1] }));

const NV_WARRANTY_CHANNELS = ["Бот", "Telegram", "Звонок", "Лично"];
const NV_FIX_TYPES = ["Работа", "Детали"];

const NV_PAYMENT_STATUSES = ["Ожидается", "Подтверждён", "Аннулирован"];
const NV_CONFIRMERS = ["Владелец", "Платформа"];

const NV_CANCEL_PARTS = [
  ["none", "Никому (деталей нет)"],
  ["client", "Клиенту"],
  ["shop_or_client", "Магазину или клиенту"],
].map((r) => ({ code: r[0], label: r[1] }));

const NV_REPORT_ACCEPTED = ["Нет", "Клиентом", "По сроку"];

const NV_CATEGORIES = [
  "Процессор",
  "Видеокарта",
  "Материнская плата",
  "Память",
  "SSD / накопитель",
  "Блок питания",
  "Корпус",
  "Охлаждение",
  "Монитор",
  "Периферия",
  "Мебель",
  "Свет и декор",
  "Акустика",
  "Кабели и мелочи",
  "Лицензии",
  "Другое",
];
const NV_SHOPS = ["Магазин 1", "Магазин 2", "Магазин 3"];
const NV_LOANERS = [
  "Видеокарта (подменная)",
  "Монитор (подменный)",
  "Блок питания (подменный)",
  "Накопитель (подменный)",
];
const NV_RECEIPT_DOCS = ["Фискальный чек", "ЭСФ", "Без чека с согласием"];
const NV_PAID_WITH = ["Корпоративная карта", "Перевод"];
const NV_ESF_STATUSES = ["Ожидается", "Подписана", "Отклонена"];
const NV_BOUGHT_BY = ["Владелец", "Помощник"];
const NV_RESERVE_FUNDS = ["Гарантийный", "Налоговый риск"];
const NV_RESERVE_BASES = [
  "Стартовый взнос",
  "Взнос при сдаче",
  "Взнос при сверке",
  "Расход на гарантийный случай",
  "Возврат после ответа налоговой",
  "Поправка",
];
const NV_ACTORS = ["Владелец", "Помощник", "Клиент", "Система", "Платформа"];
const NV_HOW = ["Вручную", "Платформа", "Принудительно"];
const NV_SOURCES = ["Вручную", "Платформа"];
const NV_OBJECTS = ["Заявка", "Заказ", "Гарантия", "Настройки"];
const NV_WEBHOOK_TYPES = [
  "lead.created",
  "order.status_changed",
  "payment.confirmed",
  "purchase.recorded",
  "warranty.case_opened",
];
const NV_WEBHOOK_ERRORS = ["bad_signature", "stale", "bad_payload", "unknown_type", "wrong_env", "locked"];
const NV_WEBHOOK_RESULTS = ["Применено", "Повтор", "Устарело", "Отклонено"];
const NV_PERIODS = ["Этот месяц", "Прошлый месяц", "Квартал", "С начала года", "12 месяцев", "Всё время"];
const NV_YEARS = [2026, 2027, 2028, 2029, 2030];
const NV_TASK_STATES = ["Просрочено", "Сегодня", "Завтра", "На неделе"];
const NV_OTHER_INCOME_KINDS = ["Прочий доход ИП", "Возврат от магазина", "Другое"];

/** The code of the customer-facing status for the "prepaid" half of accepted. */
const NV_CUSTOMER_PREPAID = "Предоплата получена";

function nvStatusByCode(code) {
  return NV_STATUSES.find((s) => s.code === code) || null;
}

function nvStatusByLabel(label) {
  return NV_STATUSES.find((s) => s.label === label || s.code === label) || null;
}

function nvEventByCode(code) {
  return NV_EVENTS.find((e) => e.code === code) || null;
}

function nvEventByLabel(label) {
  return NV_EVENTS.find((e) => e.label === label || e.code === label) || null;
}

/** Events the owner may pick in the "Действие" dropdown of a status. */
function nvAllowedEvents(statusCode) {
  const out = [];
  NV_TRANSITIONS.forEach((t) => {
    if (t.from !== statusCode) return;
    const ev = nvEventByCode(t.event);
    if (ev?.ui) out.push(ev);
  });
  return out;
}

/** The transition for a status and event (null if the automaton has none). */
function nvFindTransition(statusCode, eventCode) {
  return NV_TRANSITIONS.find((t) => t.from === statusCode && t.event === eventCode) || null;
}

function nvCancelPointFor(statusCode) {
  const p = NV_CANCEL_POINTS.find((x) => x.statuses.indexOf(statusCode) >= 0);
  return p ? p.code : null;
}

function nvLeadStatusByLabel(label) {
  return NV_LEAD_STATUSES.find((s) => s.label === label || s.code === label) || null;
}

function nvScopeByLabel(label) {
  return NV_SCOPES.find((s) => s.label === label || s.code === label) || null;
}

function nvKindByLabel(label) {
  return NV_KINDS.find((s) => s.label === label || s.code === label) || null;
}
