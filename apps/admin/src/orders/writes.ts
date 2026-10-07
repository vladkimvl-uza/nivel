// The writes of the orders screens that no scenario of the services covers (WP-07 has none for them): the passport of a
// build, the warranty case, the income of the other activity of the sole proprietor. Each one checks the role, validates
// the form, and writes the row together with its entry of the journal in one transaction (`withAudit`). The status of the
// warranty case follows `warrantyTransition` of the domain; deadlines come from `warrantyDeadlines`.

import { LEAD_CHANNELS } from "@nivel/contracts/leads";
import { UuidSchema } from "@nivel/contracts/orders";
import type { Db } from "@nivel/db";
import { buildPassports, warrantyCases } from "@nivel/db";
import { type Executor, ops, sales } from "@nivel/db/repos";
import { createWorkCalendar, isoDateInTashkent, type WorkCalendar } from "@nivel/domain/calendar";
import {
  type ClientFault,
  type WarrantyEvent,
  type WarrantyStatus,
  warrantyDeadlines,
  warrantyTransition,
} from "@nivel/domain/warranty";
import { and, eq } from "drizzle-orm";
import { type AuditSink, withAudit } from "../auth/audit.ts";
import type { Role } from "../auth/roles.ts";
import { canDo } from "./access.ts";
import { type FormInput, parseSum } from "./build-event.ts";
import type { Outcome } from "./commands.ts";
import { PASSPORT_STATUSES, WARRANTY_STATUS_LABEL } from "./labels.ts";

export interface Writer {
  db: Db;
  audit: AuditSink;
  user: { id: string; role: Role };
  now(): Date;
  ipHash?: string | null;
}

/** What `withAudit` hands over is the transaction it opened (the sink of the tests has none: then the pool). */
const executorOf = (w: Writer, tx: unknown): Executor => (tx as Executor | undefined) ?? w.db;
const fail = (message: string): Outcome => ({ ok: false, message });
const DENIED: Outcome = { ok: false, message: "Это действие недоступно вашей роли.", denied: true };
const text = (form: FormInput, name: string): string | undefined => {
  const v = form.get(name)?.trim();
  return v === undefined || v === "" ? undefined : v;
};
const lines = (raw: string | null): string[] =>
  (raw ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
const meta = (w: Writer, action: string, entity: string, entityId: string | null) => ({
  actor: `admin:${w.user.id}`,
  action,
  entity,
  entityId,
  ipHash: w.ipHash ?? null,
});

// ---- the passport of a build -------------------------------------------------------------------------------------
const MAX_TEXT = 200;
const MAX_MINUTES = 24 * 60;

/** The most lines of serial numbers a passport takes: a PC has a few dozen parts. */
const MAX_SERIAL_LINES = 100;

/**
 * "Процессор: SN123" per line -> { "Процессор": "SN123" }. A line without a colon names the component by its own text.
 * Two parts of one name (two memory modules, three fans) are both kept: the next one is "Оперативная память (2)", which
 * is what the form shows back, so a save of the saved text changes nothing.
 */
export function parseSerials(raw: string | null): Record<string, string> | null {
  const out: Record<string, string> = {};
  const all = lines(raw);
  if (all.length > MAX_SERIAL_LINES) return null;
  for (const line of all) {
    const i = line.indexOf(":");
    const name = (i < 0 ? line : line.slice(0, i)).trim();
    const serial = (i < 0 ? line : line.slice(i + 1)).trim();
    if (name === "" || serial === "" || name.length > 80 || serial.length > 80) return null;
    let key = name;
    for (let n = 2; Object.hasOwn(out, key); n += 1) key = `${name} (${n})`;
    out[key] = serial;
  }
  return out;
}

/** The kinds of the files of the registry that a passport takes as the photos of the build and of the seals. */
const PASSPORT_PHOTO_KIND = { photos: "part_photo", seals: "serial_photo" } as const;

export async function savePassport(w: Writer, orderId: string, form: FormInput): Promise<Outcome> {
  if (!canDo(w.user.role, "passport.write")) return DENIED;
  if (!UuidSchema.safeParse(orderId).success) return fail("Заказ не найден.");
  const serials = parseSerials(form.get("serials"));
  if (serials === null) return fail("Серийные номера: одна строка — «Деталь: номер», до 80 знаков.");
  const minutesText = text(form, "minutes");
  const minutes = minutesText === undefined ? undefined : parseSum(minutesText);
  if (minutes === null || (minutes !== undefined && minutes > MAX_MINUTES)) {
    return fail("Длительность теста — целое число минут, не больше суток.");
  }
  const peakText = text(form, "peakTempC");
  const peak = peakText === undefined ? undefined : parseSum(peakText);
  if (peak === null || (peak !== undefined && peak > 150))
    return fail("Пиковая температура — целое число градусов до 150.");
  const errors = lines(form.get("errors"));
  const tool = text(form, "tool");
  const scenario = text(form, "scenario");
  const bios = text(form, "biosVersion");
  const os = text(form, "os");
  const label = text(form, "labelCode");
  const notes = text(form, "notes");
  for (const [name, value] of Object.entries({ tool, scenario, bios, os, label })) {
    if (value !== undefined && value.length > MAX_TEXT) return fail(`Поле «${name}» длиннее ${MAX_TEXT} знаков.`);
  }
  if (notes !== undefined && notes.length > 2000) return fail("Заметки длиннее 2000 знаков.");
  const added = {
    photos: form.getAll("photoIds").filter((v) => v !== ""),
    seals: form.getAll("sealPhotoIds").filter((v) => v !== ""),
  };
  if (![...added.photos, ...added.seals].every((v) => UuidSchema.safeParse(v).success)) {
    return fail("Фото выбрано неверно.");
  }
  for (const [group, ids] of Object.entries(added) as [keyof typeof added, string[]][]) {
    for (const id of new Set(ids)) {
      const file = await ops.getFile(w.db, id);
      if (file?.kind !== PASSPORT_PHOTO_KIND[group]) {
        return fail("Фото: файл не найден или это снимок другого документа. Загрузите фото ещё раз.");
      }
    }
  }

  const order = await sales.getOrder(w.db, orderId);
  if (!order) return fail("Заказ не найден.");
  if (!PASSPORT_STATUSES.has(order.status)) {
    return fail("Паспорт заполняется, пока заказ в сборке, на тестах или готов к выдаче.");
  }
  const tests = {
    ...(tool ? { tool } : {}),
    ...(scenario ? { scenario } : {}),
    ...(minutes === undefined ? {} : { minutes }),
    ...(peak === undefined ? {} : { peakTempC: peak }),
    errors,
  };
  // The form does not hold the photos that were saved before (the picker starts empty on every page), nor the notes if it
  // has no such field: what it does not bring is kept, what it brings is added. A photo of a passport is a document of
  // the customer; it leaves the passport only by a decision of its own, never by saving another field.
  const notesSent = form.get("notes") !== null;
  await withAudit(w.audit, meta(w, "order.passport_save", "sales.build_passports", orderId), async (tx) => {
    const ex = executorOf(w, tx);
    const before = await ex.query.buildPassports.findFirst({ where: (t, { eq }) => eq(t.orderId, orderId) });
    const merged = (kept: unknown, more: string[]): string[] => [
      ...new Set([...(Array.isArray(kept) ? kept.filter((v): v is string => typeof v === "string") : []), ...more]),
    ];
    const values = {
      serials,
      biosVersion: bios ?? null,
      os: os ?? null,
      tests,
      photos: merged(before?.photos, added.photos),
      sealPhotos: merged(before?.sealPhotos, added.seals),
      labelCode: label ?? null,
      notes: notesSent ? (notes ?? null) : (before?.notes ?? null),
    };
    await ex
      .insert(buildPassports)
      .values({ orderId, ...values })
      .onConflictDoUpdate({ target: buildPassports.orderId, set: values });
    return { value: undefined, entityId: orderId, before: before ?? null, after: { orderId, ...values } };
  });
  return { ok: true, message: "Паспорт сборки сохранён.", id: orderId };
}

// ---- the warranty case --------------------------------------------------------------------------------------------
const CALENDAR_KEY = "calendar.work";
const DEFAULT_HOURS = { from: "10:00", to: "19:00" };

async function loadCalendar(db: Db): Promise<WorkCalendar> {
  const stored = (await ops.getSetting(db, CALENDAR_KEY))?.value as
    | { holidays?: unknown; from?: unknown; to?: unknown }
    | undefined;
  const holidays = Array.isArray(stored?.holidays)
    ? stored.holidays.filter((h): h is string => typeof h === "string")
    : [];
  const hours =
    typeof stored?.from === "string" && typeof stored?.to === "string"
      ? { from: stored.from, to: stored.to }
      : DEFAULT_HOURS;
  return createWorkCalendar(holidays, hours);
}

const HANDED = new Set(["handed_over", "closed"]);
/** Where the customer came from: the channels of the system. The form has none, so what is sent is checked. */
const CASE_CHANNELS: readonly string[] = LEAD_CHANNELS;

export async function openWarrantyCase(w: Writer, orderId: string, form: FormInput): Promise<Outcome> {
  if (!canDo(w.user.role, "warranty.write")) return DENIED;
  const description = text(form, "description");
  if (!description) return fail("Опишите, что случилось.");
  if (description.length > 2000) return fail("Описание длиннее 2000 знаков.");
  const channel = text(form, "channel") ?? "admin";
  if (!CASE_CHANNELS.includes(channel)) return fail("Канал обращения не распознан.");
  if (!UuidSchema.safeParse(orderId).success) return fail("Заказ не найден.");
  const order = await sales.getOrder(w.db, orderId);
  if (!order) return fail("Заказ не найден.");
  if (!HANDED.has(order.status)) return fail("Гарантийный случай открывается по заказу, который передан клиенту.");
  const now = w.now();
  const deadlines = warrantyDeadlines(now, await loadCalendar(w.db));
  const id = await withAudit(w.audit, meta(w, "warranty.open", "sales.warranty_cases", null), async (tx) => {
    const ex = executorOf(w, tx);
    const year = Number(isoDateInTashkent(now).slice(0, 4));
    const number = await ops.nextNumber(ex, "G", year);
    const [row] = await ex
      .insert(warrantyCases)
      .values({
        number,
        orderId,
        openedAt: now,
        channel,
        description,
        dueReply: deadlines.reply,
        dueDiagnosis: deadlines.diagnosis,
        dueLoaner: deadlines.loaner,
        dueFix: deadlines.fixWork,
      })
      .returning({ id: warrantyCases.id });
    if (!row) throw new Error("the warranty case was not written");
    return { value: { id: row.id, number }, entityId: row.id, after: { number, orderId, description } };
  });
  return { ok: true, message: `Гарантийный случай ${id.number} открыт.`, id: id.id };
}

const CAUSES: readonly ClientFault[] = ["impact", "liquid", "overclocking", "third_party_replacement"];
const WARRANTY_EVENTS = ["START_DIAGNOSIS", "SEND_TO_SUPPLIER", "RESOLVE", "REJECT", "CLOSE"] as const;

class CaseMoved extends Error {}

export async function advanceWarranty(w: Writer, caseId: string, form: FormInput): Promise<Outcome> {
  if (!canDo(w.user.role, "warranty.write")) return DENIED;
  const type = WARRANTY_EVENTS.find((t) => t === form.get("event"));
  if (!type) return fail("Выберите действие по гарантийному случаю.");
  if (!UuidSchema.safeParse(caseId).success) return fail("Гарантийный случай не найден.");
  const found = await w.db.query.warrantyCases.findFirst({ where: (t, { eq }) => eq(t.id, caseId) });
  if (!found) return fail("Гарантийный случай не найден.");
  let event: WarrantyEvent;
  if (type === "REJECT") {
    const fault = CAUSES.find((c) => c === form.get("clientFault"));
    const evidence = text(form, "evidence") ?? "";
    // The domain refuses a rejection without a cause and evidence; the form asks for both before it gets there.
    event = { type, clientFault: fault as ClientFault, evidence };
  } else {
    event = { type };
  }
  const result = warrantyTransition(found.status as WarrantyStatus, event);
  if (!result.ok) {
    return fail(
      result.error === "fault_evidence_missing"
        ? "Отказ возможен только с причиной по вине клиента (удар, жидкость, разгон, замена не исполнителем) и описанием доказательства."
        : "В этом состоянии такое действие по случаю недоступно.",
    );
  }
  const closed = result.next === "closed";
  try {
    await withAudit(w.audit, meta(w, "warranty.advance", "sales.warranty_cases", caseId), async (tx) => {
      const ex = executorOf(w, tx);
      // The change is made from the status that was read: when somebody has moved the case meanwhile, nothing is written
      // (and the entry of the journal goes back with the transaction), so two presses at once do not both win.
      const moved = await ex
        .update(warrantyCases)
        .set({
          status: result.next,
          ...(event.type === "REJECT"
            ? { clientFault: event.clientFault, vendorClaim: { rejection: { evidence: event.evidence } } }
            : {}),
          ...(closed ? { closedAt: w.now() } : {}),
        })
        .where(and(eq(warrantyCases.id, caseId), eq(warrantyCases.status, found.status)))
        .returning({ id: warrantyCases.id });
      if (moved.length === 0) throw new CaseMoved();
      return { value: undefined, entityId: caseId, before: { status: found.status }, after: { status: result.next } };
    });
  } catch (error) {
    if (error instanceof CaseMoved) return fail("Случай уже изменили: обновите страницу и повторите.");
    throw error;
  }
  return {
    ok: true,
    message: `Случай ${found.number}: ${WARRANTY_STATUS_LABEL[result.next] ?? result.next}.`,
    id: caseId,
  };
}

// ---- the income of the other activity -----------------------------------------------------------------------------
const PERIOD = /^(\d{4})-(0[1-9]|1[0-2])$/;

export async function addOtherIncome(w: Writer, form: FormInput): Promise<Outcome> {
  if (!canDo(w.user.role, "registry.write")) return DENIED;
  const period = text(form, "period") ?? "";
  const m = PERIOD.exec(period);
  if (!m) return fail("Период — месяц вида 2026-10.");
  const amount = parseSum(form.get("amountSum"));
  if (amount === null || amount < 1) return fail("Сумма — целое число сумов, больше нуля.");
  // A row of this journal cannot be taken back (the sum must be above zero, so a reversal row is impossible): the sum is
  // typed twice, and what is wrong is stopped here and not in the threshold of the year.
  const again = parseSum(form.get("amountAgain"));
  if (again === null) return fail("Введите сумму ещё раз в поле проверки: запись о доходе нельзя убрать.");
  if (again !== amount) return fail("Суммы не совпадают: проверьте цифры и введите сумму заново.");
  const note = text(form, "note");
  if (note !== undefined && note.length > 500) return fail("Примечание длиннее 500 знаков.");
  const year = Number(m[1]);
  const id = await withAudit(w.audit, meta(w, "registry.other_income_add", "sales.other_income", null), async (tx) => {
    const ex = executorOf(w, tx);
    const created = await sales.addOtherIncome(ex, {
      year,
      period,
      amountSum: amount,
      ...(note === undefined ? {} : { note }),
      enteredBy: `admin:${w.user.id}`,
    });
    return { value: created, entityId: created, after: { year, period, amountSum: amount } };
  });
  return { ok: true, message: "Доход другой деятельности записан: он входит в сделки года.", id };
}
