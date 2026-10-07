"use server";

// Server actions of the settings screens. Each one: the role (and a journal entry for a refusal), the form read back
// into a value, the service. The answer is what the form draws next: errors by field, the values typed.
import { revalidatePath } from "next/cache";
import { guardAction, NOT_ALLOWED, requestInfo } from "../../auth/next.ts";
import { getRuntime } from "../../auth/runtime.ts";
import { formDataSource, readFields } from "../form.ts";
import type { FormState } from "../ui/SchemaForm.tsx";
import { calendarFromForm, FEE_ROOT, flagsFromForm, THRESHOLD_ROOT } from "./forms.ts";

const denied = (values: unknown): FormState => ({ ok: false, message: NOT_ALLOWED, errors: {}, values });

function version(data: FormData): number {
  const n = Number(data.get("expectedVersion"));
  return Number.isInteger(n) && n >= 0 ? n : -1;
}

const ruDate = (iso: string) => iso.split("-").reverse().join(".");

function afterSave(revalidated: boolean): string {
  return revalidated
    ? ""
    : " Сайт сейчас не ответил: запрос на обновление поставлен в очередь на повтор. Пока он не выполнен, сайт может показывать прежние значения.";
}

export async function saveFeeAction(_previous: FormState, data: FormData): Promise<FormState> {
  const user = await guardAction("settings.money.write", "settings.save_fee", "ops.settings");
  const read = readFields(FEE_ROOT, formDataSource(data));
  if (!user) return denied(read.value);
  if (Object.keys(read.problems).length > 0) return { ok: false, errors: read.problems, values: read.value };
  const { ipHash } = await requestInfo();
  const result = await getRuntime().settings.saveFee(user, read.value, {
    expectedVersion: version(data),
    ...(ipHash ? { ipHash } : {}),
  });
  if (!result.ok) return { ok: false, errors: result.errors, values: read.value };
  revalidatePath("/settings/money");
  const effective = (read.value as { effectiveFrom: string }).effectiveFrom;
  return {
    ok: true,
    errors: {},
    values: read.value,
    message: result.scheduled
      ? `Сохранено как запланированное: шкала вступит в силу ${ruDate(effective)}. До этой даты действует текущая.`
      : `Сохранено: новая версия шкалы действует с ${ruDate(effective)}.${afterSave(result.revalidated)}`,
  };
}

export async function cancelScheduledFeeAction(): Promise<void> {
  const user = await guardAction("settings.money.write", "settings.cancel_fee", "ops.settings");
  if (!user) return;
  await getRuntime().settings.cancelScheduledFee(user);
  revalidatePath("/settings/money");
}

export async function saveThresholdAction(_previous: FormState, data: FormData): Promise<FormState> {
  const user = await guardAction("settings.money.write", "settings.save_threshold", "ops.settings");
  const read = readFields(THRESHOLD_ROOT, formDataSource(data));
  if (!user) return denied(read.value);
  if (Object.keys(read.problems).length > 0) return { ok: false, errors: read.problems, values: read.value };
  const { ipHash } = await requestInfo();
  const result = await getRuntime().settings.saveThreshold(user, read.value, {
    expectedVersion: version(data),
    ...(ipHash ? { ipHash } : {}),
  });
  if (!result.ok) return { ok: false, errors: result.errors, values: read.value };
  revalidatePath("/settings/money");
  return { ok: true, errors: {}, values: read.value, message: `Сохранено.${afterSave(result.revalidated)}` };
}

export async function saveCalendarAction(_previous: FormState, data: FormData): Promise<FormState> {
  const user = await guardAction("settings.calendar.write", "settings.save_calendar", "ops.settings");
  const source = formDataSource(data);
  const read = calendarFromForm(source);
  const typed = {
    workdays: (read.value as { workdays: number[] }).workdays,
    from: source.get("from") ?? "",
    to: source.get("to") ?? "",
    holidays: source.get("holidays") ?? "",
  };
  if (!user) return denied(typed);
  // A date that is not a date stops the save: the rest of the form must not be written without it.
  if (Object.keys(read.errors).length > 0) return { ok: false, errors: read.errors, values: typed };
  const { ipHash } = await requestInfo();
  const result = await getRuntime().settings.saveCalendar(user, read.value, {
    expectedVersion: version(data),
    ...(ipHash ? { ipHash } : {}),
  });
  if (!result.ok) return { ok: false, errors: result.errors, values: typed };
  revalidatePath("/settings/calendar");
  return { ok: true, errors: {}, values: typed, message: `Сохранено.${afterSave(result.revalidated)}` };
}

export async function saveFlagsAction(_previous: FormState, data: FormData): Promise<FormState> {
  const user = await guardAction("settings.flags.write", "settings.save_flags", "ops.settings");
  const typed = Object.fromEntries(
    ["ai", "setupConfigurator", "scene", "miniApp"].map((k) => [k, data.get(k) === "true"]),
  );
  if (!user) return denied(typed);
  const result = await getRuntime().settings.saveFlags(user, flagsFromForm(formDataSource(data)));
  if (!result.ok) return { ok: false, errors: result.errors, values: typed };
  revalidatePath("/settings/flags");
  return {
    ok: true,
    errors: {},
    values: typed,
    message: result.changed.length === 0 ? "Ничего не изменилось." : `Сохранено.${afterSave(result.revalidated)}`,
  };
}
