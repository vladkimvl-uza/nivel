// What the person reads when something is refused (ARCHITECTURE 6.3: "a refusal shows the text of GuardError"). The
// services answer with a code of the automaton (GuardError) or throw an exception with an English message for the
// logs; the screen shows Russian text only, chosen by the code.
import { orders } from "@nivel/services";

export const SERVICE_FALLBACK =
  "Не удалось выполнить действие. Проверьте данные и повторите; если повторится, откройте журнал.";

/** GuardError of the table 4.9, in Russian, each with what to do next. */
export const GUARD_TEXT = {
  actor_not_allowed: "Это действие недоступно вашей роли: его выполняет владелец.",
  invalid_transition: "В текущем статусе заказа это действие не выполняется. Обновите страницу: статус мог измениться.",
  estimate_expired: "Срок сметы истёк, цены могли измениться. Верните смету в работу и пересчитайте её.",
  manual_check_missing: "Смета не отмечена как проверенная вручную: проверьте строки и отметьте.",
  compat_block: "Сборка несовместима: пока есть замечание «нельзя», смету отправить нельзя. Замените деталь.",
  not_eligible: "Смета ниже минимума полного цикла: заказ возможен только как «Подбор» или при свободном окне.",
  offer_not_published: "Оферта на узбекском и русском ещё не опубликована: принять смету можно после публикации.",
  consent_missing:
    "Не хватает согласия клиента или фото чека: покупка без чека записывается только с согласием клиента.",
  payments_incomplete:
    "Платежи неполные: нужен подтверждённый платёж на всю сумму. Плата идёт через QR с номером чека, деньги на закупку — переводом на счёт ИП.",
  purchase_too_early: "Закупка раньше начала следующего рабочего дня после поступления денег не допускается.",
  meeting_required: "Первый заказ клиента на крупную сумму: сначала встреча или видеозвонок, отметьте её в заказе.",
  limit_exceeded: "Чеки превысят лимит закупки. Запишите согласие клиента на превышение или уменьшите покупку.",
  funds_exceeded:
    "Чеки превысят деньги, полученные от клиента. Своими деньгами за клиента не платим: дождитесь доплаты.",
  purchases_incomplete: "Закупки не закрыты: не все строки сметы куплены или сняты с согласия клиента.",
  not_reconciled:
    "Деньги не сходятся: поступило должно равняться закуплено плюс возвращено. Подтвердите возврат остатка и повторите.",
  report_objection_open: "У клиента открыто возражение к отчёту, или срок возражений ещё не вышел.",
  final_payment_missing: "Нет подтверждённой окончательной платы: она принимается через QR с номером чека.",
  act_missing: "Нет подписанного акта нужного вида. Составьте акт и подпишите его (фото бумажного акта).",
  passport_missing: "Паспорт сборки не заполнен, тест короче шести часов или в нём есть ошибки: дополните паспорт.",
} as const satisfies Record<string, string>;

export function guardText(code: string): string {
  return Object.hasOwn(GUARD_TEXT, code) ? GUARD_TEXT[code as keyof typeof GUARD_TEXT] : SERVICE_FALLBACK;
}

/** Codes of ValidationError (services) in Russian: a short reason, no English from the logs. */
const ISSUE_TEXT: Record<string, string> = {
  act_already_signed: "акт уже подписан",
  admin_user_required: "смету проверяет учётная запись админки",
  admin_user_unknown: "учётная запись не найдена",
  amount_mismatch: "сумма задана сметой и не совпадает",
  amount_zero: "сумма должна быть больше нуля",
  bool_invalid: "нужно значение «да» или «нет»",
  build_invalid: "сборка собрана неверно",
  category_unknown: "неизвестная категория",
  configuration_unknown: "сохранённая сборка не найдена",
  consent_mismatch: "согласие не относится к этому заказу",
  customer_erased: "клиент обезличен, выбрать его нельзя",
  customer_exists: "такой клиент уже есть",
  customer_missing: "у заявки нет клиента",
  customer_unknown: "клиент не найден",
  date_in_future: "время не может быть в будущем",
  date_invalid: "неверная дата",
  document_unknown: "документ не найден",
  esf_status_required: "укажите состояние ЭСФ",
  evidence_invalid: "подтверждение подписи неверно",
  evidence_mismatch: "подтверждение подписи принадлежит другому клиенту",
  evidence_required: "нужно подтверждение: фото бумажного акта",
  fee_group_unknown: "неизвестная группа платы",
  file_kind_invalid: "файл другого вида: для бумажного акта нужен снимок акта",
  file_unknown: "файл не найден: загрузите снимок ещё раз",
  invalid_reversal: "сторно не подходит к этому платежу",
  kind_unknown: "неизвестный вид",
  lead_already_bound: "заявка уже привязана к другому клиенту",
  lead_not_open: "заявка уже обработана",
  lead_without_customer: "у заявки нет клиента: сначала привяжите клиента",
  line_invalid: "строка сметы неверна",
  lines_ambiguous: "укажите строки или сохранённую сборку, не оба",
  lines_required: "нужна хотя бы одна строка",
  mixed_ownership: "в одной позиции смешаны свои и клиентские детали",
  no_accepted_quote: "нет принятой сметы",
  no_current_quote: "у заказа нет сметы: лимита закупки нет",
  no_open_objection: "открытого возражения нет",
  no_price: "у позиции нет рыночной цены: введите цену на странице цен",
  no_quote: "у заказа нет сметы, сумма неизвестна",
  not_a_list: "нужен список",
  number_invalid: "нужно число",
  order_not_draft: "смету можно менять только пока заказ в черновике",
  order_required: "нужен заказ",
  order_status: "в этом статусе заказа действие недоступно",
  pair_invalid:
    "такой способ оплаты для этого вида платежа не допускается: плата только через QR, деньги на закупку только переводом на счёт ИП",
  payment_not_confirmed: "платёж не подтверждён",
  payment_not_expected: "платёж уже подтверждён или аннулирован",
  photo_required: "нужно фото чека или согласие клиента на покупку без чека",
  product_id_invalid: "позиция каталога указана неверно",
  product_unknown: "позиции нет в каталоге",
  purchase_duplicate: "эта покупка уже записана",
  qty_invalid: "количество должно быть целым числом от 1",
  qty_too_large: "количество слишком велико",
  quote_invalid: "смету рассчитать нельзя",
  quote_line_unknown: "строки нет в текущей смете",
  quote_not_draft: "отправить можно только черновик сметы",
  receipt_no_required: "нужен номер фискального чека",
  receipt_required: "нужен номер чека: плата принимается только с чеком",
  fiscal_receipt_required: "нужен номер фискального чека: плата принимается только через QR с чеком",
  reference_unknown: "ссылка на несуществующую запись",
  report_outdated: "отчёт устарел: сформируйте новый после последних закупок",
  report_unknown: "отчёт не найден",
  single_part_violated: "в ПК одна деталь этого вида",
  statement_required: "деньги третьего лица принимаются только с письменным заявлением: приложите файл",
  sum_invalid: "сумма должна быть целым числом сумов",
  tasks_invalid: "задачи выбраны неверно",
  text_invalid: "нужен текст, не пустой и не слишком длинный",
  title_invalid: "название от 1 до 200 знаков",
  too_many_lines: "слишком много строк",
  unknown_product: "позиции нет в каталоге",
  uuid_invalid: "идентификатор указан неверно",
  vendor_unknown: "магазин не найден",
  via_not_allowed: "такой способ подписи не допускается",
  year_invalid: "год указан неверно",
};

/** Names of the fields in the messages of the issues. */
const FIELD_TEXT: Record<string, string> = {
  amountSum: "Сумма",
  qty: "Количество",
  receiptNo: "Номер чека",
  fiscalReceiptNo: "Номер фискального чека",
  bankDocNo: "Номер платёжного документа",
  esfNo: "Номер ЭСФ",
  esfStatus: "Состояние ЭСФ",
  vendorId: "Магазин",
  receiptFileIds: "Фото чека",
  receiptKind: "Вид чека",
  serials: "Серийные номера",
  reason: "Причина",
  note: "Ответ",
  text: "Текст",
  method: "Способ оплаты",
  kind: "Вид",
  thirdPartyStatementFileId: "Заявление плательщика",
  fileId: "Файл",
  paymentId: "Платёж",
  orderId: "Заказ",
  leadId: "Заявка",
  customerId: "Клиент",
  quoteId: "Смета",
  reportId: "Отчёт",
  actId: "Акт",
  year: "Год",
};

const capital = (s: string): string => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

function issueText(path: string, code: string): string {
  const reason = ISSUE_TEXT[code] ?? "значение не принято";
  const last =
    path
      .split(".")
      .filter((p) => !/^\d+$/.test(p))
      .at(-1) ?? "";
  const field = FIELD_TEXT[path] ?? FIELD_TEXT[last] ?? null;
  return field ? `${field}: ${reason}.` : `${capital(reason)}.`;
}

const NOT_FOUND_TEXT: Record<string, string> = {
  order: "Заказ не найден.",
  lead: "Заявка не найдена.",
  customer: "Клиент не найден.",
  payment: "Платёж не найден.",
  act: "Акт не найден.",
  quote: "Смета не найдена.",
  configuration: "Сохранённая сборка не найдена.",
};

/** What the services throw on purpose: a refusal with a reason the person can act on. Everything else is a failure. */
export function isExpected(error: unknown): boolean {
  return (
    error instanceof orders.ValidationError ||
    error instanceof orders.ForbiddenError ||
    error instanceof orders.NotFoundError ||
    error instanceof orders.ConfigError
  );
}

/**
 * The text for what a command caught. A refusal of the services becomes its Russian text; anything else is a failure
 * nobody planned: the person sees the general text, and the server log gets the command and the error itself (the
 * stack is the only trace of why a money operation did not go through).
 */
export function explain(error: unknown, where: string): string {
  if (!isExpected(error)) console.error(`[orders] ${where} failed:`, error);
  return errorText(error);
}

/** The Russian text for what the services threw. Anything unexpected is the general text: details go to the log of the server (`explain`). */
export function errorText(error: unknown): string {
  if (error instanceof orders.ValidationError) {
    const texts = error.issues.map((i) => issueText(i.path, i.code));
    return [...new Set(texts)].join(" ");
  }
  if (error instanceof orders.ForbiddenError) return "Это действие недоступно вашей роли или этому разделу.";
  if (error instanceof orders.NotFoundError) return NOT_FOUND_TEXT[error.what] ?? "Запись не найдена.";
  if (error instanceof orders.ConfigError) {
    return "Не заданы настройки, нужные для расчёта: проверьте раздел «Настройки» и повторите.";
  }
  return SERVICE_FALLBACK;
}
