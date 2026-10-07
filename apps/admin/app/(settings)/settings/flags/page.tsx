import type { Metadata } from "next";
import { requireUser } from "../../../../src/auth/next.ts";
import { getRuntime } from "../../../../src/auth/runtime.ts";
import { saveFlagsAction } from "../../../../src/kit/settings/actions.ts";
import { FLAG_FIELDS, FLAG_LABELS, flagsToValues } from "../../../../src/kit/settings/forms.ts";
import { SchemaForm } from "../../../../src/kit/ui/SchemaForm.tsx";
import { PageTitle } from "../../../../src/nav/Shell.tsx";

export const metadata: Metadata = { title: "Флаги" };
export const dynamic = "force-dynamic";

export default async function FlagsPage() {
  const user = await requireUser(["settings.flags.read"]);
  const flags = await getRuntime().settings.loadFlags(user);
  return (
    <>
      <PageTitle
        title="Флаги"
        lead="Незаконченная работа попадает в выпуск выключенной. Флаг включают, когда возможность готова и проверена."
      />
      <SchemaForm
        action={saveFlagsAction}
        initial={{ errors: {}, values: flagsToValues(flags) }}
        fields={FLAG_FIELDS}
        labels={FLAG_LABELS}
        submitLabel="Сохранить флаги"
        testId="flags-form"
      />
    </>
  );
}
