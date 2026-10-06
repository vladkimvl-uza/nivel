import type { Metadata } from "next";
import { requireUser } from "../../../../src/auth/next.ts";
import { can } from "../../../../src/auth/roles.ts";
import { getRuntime } from "../../../../src/auth/runtime.ts";
import { saveCalendarAction } from "../../../../src/kit/settings/actions.ts";
import {
  CALENDAR_FIELDS,
  type CalendarValue,
  calendarToValues,
  SETTINGS_LABELS,
  SETTINGS_OPTION_LABELS,
} from "../../../../src/kit/settings/forms.ts";
import { CalendarSettingsSchema } from "../../../../src/kit/settings/schemas.ts";
import { SchemaForm } from "../../../../src/kit/ui/SchemaForm.tsx";
import { PageTitle } from "../../../../src/nav/Shell.tsx";

export const metadata: Metadata = { title: "Календарь и часы ответа" };
export const dynamic = "force-dynamic";

export default async function CalendarSettingsPage() {
  const user = await requireUser(["settings.calendar.read"]);
  const calendar = await getRuntime().settings.loadCalendar(user);
  const parsed = CalendarSettingsSchema.safeParse(calendar.value);
  const value = parsed.success ? (parsed.data as CalendarValue) : null;
  const writable = can(user.role, "settings.calendar.write");

  return (
    <>
      <PageTitle
        title="Календарь и часы ответа"
        lead="Часы ответа по Ташкенту и нерабочие дни: от них считаются сроки ответа клиенту, напоминания и автоответ бота."
      />
      {writable && value ? (
        <SchemaForm
          action={saveCalendarAction}
          initial={{ errors: {}, values: calendarToValues(value) }}
          fields={CALENDAR_FIELDS}
          labels={SETTINGS_LABELS}
          optionLabels={SETTINGS_OPTION_LABELS}
          hidden={{ expectedVersion: String(calendar.version) }}
          submitLabel="Сохранить календарь"
          testId="calendar-form"
        >
          <p className="adm-note">Праздники — по одной дате в строке: 31.12.2026 или 2026-12-31.</p>
        </SchemaForm>
      ) : value ? (
        <dl className="adm-kv" data-testid="calendar-readonly">
          <dt>Рабочие дни</dt>
          <dd>{value.workdays.map((d) => SETTINGS_OPTION_LABELS.workdays?.[String(d)]).join(", ")}</dd>
          <dt>Часы ответа</dt>
          <dd>
            {value.from}–{value.to}
          </dd>
          <dt>Нерабочие дни</dt>
          <dd>{value.holidays.length > 0 ? value.holidays.join(", ") : "не заданы"}</dd>
        </dl>
      ) : (
        <p className="adm-flash adm-flash--error" role="alert">
          Календарь не настроен.
        </p>
      )}
    </>
  );
}
