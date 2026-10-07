import type { Metadata } from "next";
import { setUserActiveAction } from "../../../src/auth/actions.ts";
import { CreateUserForm } from "../../../src/auth/forms.tsx";
import { requireUser } from "../../../src/auth/next.ts";
import { ROLE_LABELS } from "../../../src/auth/roles.ts";
import { getRuntime } from "../../../src/auth/runtime.ts";
import { PageTitle } from "../../../src/nav/Shell.tsx";

export const metadata: Metadata = { title: "Пользователи" };
export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const me = await requireUser(["users.manage"]);
  const accounts = await getRuntime().auth.listAccounts();
  return (
    <>
      <PageTitle
        title="Пользователи"
        lead="Кто может входить в админку. Пароль, ключ для приложения и коды восстановления показываются один раз при создании."
      />
      <div className="adm-table-wrap">
        <table className="adm-table" data-testid="users-table">
          <thead>
            <tr>
              <th>E-mail</th>
              <th>Роль</th>
              <th>Telegram id</th>
              <th>Состояние</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td>{a.email}</td>
                <td>{ROLE_LABELS[a.role]}</td>
                <td className="adm-num">{a.telegramUserId ?? "—"}</td>
                <td>
                  {a.active ? (a.lockedUntil && a.lockedUntil > new Date() ? "заблокирован" : "работает") : "выключен"}
                </td>
                <td>
                  {a.id === me.id ? null : (
                    <form action={setUserActiveAction}>
                      <input type="hidden" name="id" value={a.id} />
                      <input type="hidden" name="active" value={String(!a.active)} />
                      <button type="submit" className="nv-btn nv-btn--ghost nv-btn--sm">
                        {a.active ? "Выключить" : "Включить"}
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Новая учётная запись</h2>
      <CreateUserForm />
    </>
  );
}
