import type { Metadata } from "next";
import { requireUser } from "../../../../src/auth/next.ts";
import { can } from "../../../../src/auth/roles.ts";
import { getRuntime } from "../../../../src/auth/runtime.ts";
import { cancelScheduledFeeAction, saveFeeAction, saveThresholdAction } from "../../../../src/kit/settings/actions.ts";
import {
  FEE_ROOT,
  SETTINGS_LABELS,
  SETTINGS_OPTION_LABELS,
  THRESHOLD_ROOT,
} from "../../../../src/kit/settings/forms.ts";
import { FeeSettingsSchema } from "../../../../src/kit/settings/schemas.ts";
import { SchemaForm } from "../../../../src/kit/ui/SchemaForm.tsx";
import { PageTitle } from "../../../../src/nav/Shell.tsx";

export const metadata: Metadata = { title: "Деньги" };
export const dynamic = "force-dynamic";

const ruDate = (iso: string) => iso.split("-").reverse().join(".");

export default async function MoneySettingsPage() {
  const user = await requireUser(["settings.money.read"]);
  const { settings } = getRuntime();
  const writable = can(user.role, "settings.money.write");
  // A scale whose day has come is put into force before it is shown, when the person may change money settings: a
  // screen opened for reading changes nothing. (A daily job of the worker should do this; see the branch description.)
  if (writable) await settings.promoteDue();
  const [fee, threshold] = await Promise.all([settings.loadFee(user), settings.loadThreshold(user)]);
  const live = FeeSettingsSchema.safeParse(fee.value);
  const next = fee.next ? FeeSettingsSchema.safeParse(fee.next.value) : null;
  const { version: _version, ...feeValues } = live.success ? live.data : ({} as Record<string, unknown>);

  return (
    <>
      <PageTitle
        title="Деньги"
        lead="Плата, доли этапов, аванс и сроки. Суммы — в сумах, ставки — в базисных пунктах: 1500 б. п. = 15 %. Расчёт на сайте и в боте ведётся только по этим значениям."
      />
      {live.success ? (
        <p className="adm-flash adm-flash--ok" data-testid="fee-version">
          Действует версия <strong>{live.data.version}</strong> с {ruDate(live.data.effectiveFrom)}.
        </p>
      ) : (
        <p className="adm-flash adm-flash--error" role="alert">
          Сохранённая шкала не прошла проверку: сохраните её заново.
        </p>
      )}
      {next?.success ? (
        <div className="adm-flash" data-testid="fee-scheduled">
          <p>
            Запланировано: версия <strong>{next.data.version}</strong> вступит в силу {ruDate(next.data.effectiveFrom)}.
          </p>
          {writable ? (
            <form action={cancelScheduledFeeAction}>
              <button type="submit" className="nv-btn nv-btn--ghost nv-btn--sm">
                Отменить запланированное изменение
              </button>
            </form>
          ) : null}
        </div>
      ) : null}

      <h2>Шкала платы</h2>
      {writable ? (
        <SchemaForm
          action={saveFeeAction}
          initial={{ errors: {}, values: feeValues }}
          fields={FEE_ROOT.children ?? []}
          labels={SETTINGS_LABELS}
          optionLabels={SETTINGS_OPTION_LABELS}
          hidden={{ expectedVersion: String(fee.version) }}
          submitLabel="Сохранить шкалу"
          testId="fee-form"
        >
          <p className="adm-note">
            Дата в прошлом не принимается. Дата сегодня — шкала действует сразу, позже — ждёт своего дня, а пока
            действует текущая. Имя версии берётся из даты.
          </p>
        </SchemaForm>
      ) : (
        <pre className="adm-secret">{JSON.stringify(fee.value, null, 2)}</pre>
      )}

      <h2>Порог и оповещения</h2>
      {writable ? (
        <SchemaForm
          action={saveThresholdAction}
          initial={{ errors: {}, values: threshold.value }}
          fields={THRESHOLD_ROOT.children ?? []}
          labels={SETTINGS_LABELS}
          optionLabels={SETTINGS_OPTION_LABELS}
          hidden={{ expectedVersion: String(threshold.version) }}
          submitLabel="Сохранить порог"
          testId="threshold-form"
        />
      ) : (
        <pre className="adm-secret">{JSON.stringify(threshold.value, null, 2)}</pre>
      )}
    </>
  );
}
