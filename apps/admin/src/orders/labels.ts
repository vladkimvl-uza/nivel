// Russian names of the things of the order, in one place. Display only.
import type { OrderStatus } from "@nivel/domain/order";

export const STATUS_LABEL: Record<OrderStatus, string> = {
  estimate_draft: "Смета в работе",
  estimate_sent: "Смета отправлена",
  estimate_expired: "Смета истекла",
  accepted: "Принято: ждём деньги",
  purchasing: "Закупка",
  report_due: "Отчёт к сдаче",
  report_sent: "Отчёт у клиента",
  settled: "Расчёт сведён",
  assembling: "Сборка",
  testing: "Тест",
  ready: "Готово к выдаче",
  delivering: "Доставка",
  handed_over: "Передано клиенту",
  closed: "Закрыт",
  podbor_delivered: "«Подбор» передан",
  cancelling: "Отмена: расчёты",
  cancelled: "Отменён",
};

export const KIND_LABEL: Record<string, string> = {
  pc: "ПК",
  setup: "Сетап",
  podbor: "Подбор",
  upgrade: "Апгрейд",
};

export const PAYMENT_KIND_LABEL: Record<string, string> = {
  fee_advance: "Плата, аванс",
  fee_final: "Плата, окончательная часть",
  fee_extra: "Плата, доплата при отмене",
  podbor_fee: "Плата за «Подбор»",
  purchase_funds: "Деньги на закупку",
  purchase_topup: "Деньги на закупку, доплата",
  remainder_refund: "Возврат остатка",
  fee_refund: "Возврат платы",
  funds_refund: "Возврат денег на закупку",
};

export const METHOD_LABEL: Record<string, string> = {
  xolis_qr: "QR Xolis с чеком",
  merchant_card: "Карта мерчанта с чеком",
  bank_transfer_ip: "Перевод на счёт ИП",
  bank_transfer_out: "Перевод клиенту",
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  expected: "ожидается",
  confirmed: "подтверждён",
  void: "аннулирован",
};

export const ACT_KIND_LABEL: Record<string, string> = {
  material_acceptance: "Акт приёма материала клиента",
  customer_parts: "Акт возврата деталей клиента",
  handover: "Акт сдачи",
};

export const SIGNED_VIA_LABEL: Record<string, string> = {
  tg_button: "кнопкой в Telegram",
  paper_photo: "бумажный акт, фото",
  site_button: "кнопкой на сайте",
};

export const QUOTE_STATUS_LABEL: Record<string, string> = {
  draft: "черновик",
  sent: "отправлена",
  accepted: "принята",
  expired: "истекла",
  superseded: "заменена",
};

export const VERDICT_LABEL: Record<string, string> = {
  ok: "Совместимо",
  warn: "Проверьте замечания",
  block: "Несовместимо",
  incomplete: "Не хватает данных",
};

export const CONSENT_LABEL: Record<string, string> = {
  limit_overrun: "Превышение лимита закупки",
  no_receipt_purchase: "Покупка без чека",
  replacement: "Замена детали",
  third_party_payer: "Плательщик не клиент",
};

export const LEAD_STATUS_LABEL: Record<string, string> = {
  new: "новая",
  in_review: "в работе",
  converted: "стала заказом",
  rejected: "отклонена",
  spam: "спам",
};

export const SCOPE_LABEL: Record<string, string> = {
  pc: "ПК",
  pc_periph: "ПК с периферией",
  setup: "Сетап",
  podbor: "Подбор",
};

export const CHANNEL_LABEL: Record<string, string> = {
  web: "сайт",
  bot: "бот",
  tma: "мини-приложение",
  admin: "админка",
  ai: "консультант",
};

export const WARRANTY_STATUS_LABEL: Record<string, string> = {
  opened: "открыт",
  diagnosing: "диагностика",
  loaner_issued: "выдан подменный",
  at_supplier: "у поставщика",
  resolved: "решён",
  rejected: "отказ",
  closed: "закрыт",
};

export const FAULT_LABEL: Record<string, string> = {
  impact: "удар",
  liquid: "жидкость",
  overclocking: "разгон",
  third_party_replacement: "замена не исполнителем",
};
