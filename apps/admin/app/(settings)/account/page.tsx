import type { Metadata } from "next";
import { PasswordForm, RecoveryForm, TelegramForm } from "../../../src/auth/forms.tsx";
import { requireUser } from "../../../src/auth/next.ts";
import { ROLE_LABELS } from "../../../src/auth/roles.ts";
import { PageTitle } from "../../../src/nav/Shell.tsx";

export const metadata: Metadata = { title: "Учётная запись" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireUser(["account.self"]);
  return (
    <>
      <PageTitle title="Учётная запись" />
      <dl className="adm-kv" data-testid="account-info">
        <dt>E-mail</dt>
        <dd>{user.email}</dd>
        <dt>Роль</dt>
        <dd>{ROLE_LABELS[user.role]}</dd>
        <dt>Telegram id</dt>
        <dd data-testid="account-telegram">{user.telegramUserId ?? "не привязан"}</dd>
      </dl>

      <h2>Telegram</h2>
      <p className="adm-lead">
        Бот узнаёт владельца и помощника по этому номеру: команды в группе принимаются только от привязанной учётной
        записи с нужной ролью.
      </p>
      <TelegramForm current={user.telegramUserId} />

      <h2>Пароль</h2>
      <PasswordForm />

      <h2>Коды восстановления</h2>
      <p className="adm-lead">
        Десять одноразовых кодов на случай, когда телефон с приложением недоступен. Новые коды отменяют все старые.
      </p>
      <RecoveryForm />
    </>
  );
}
