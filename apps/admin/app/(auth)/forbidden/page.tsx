import type { Metadata } from "next";
import { currentUser } from "../../../src/auth/next.ts";
import { homeFor } from "../../../src/nav/nav.ts";

export const metadata: Metadata = { title: "Нет доступа" };
export const dynamic = "force-dynamic";

export default async function ForbiddenPage() {
  const user = await currentUser();
  return (
    <main className="adm-narrow">
      <h1>Нет доступа</h1>
      <p className="adm-lead" data-testid="forbidden">
        Этот раздел закрыт для вашей роли. Если он нужен для работы, попросите владельца изменить роль.
      </p>
      <p>
        <a href={user ? homeFor(user.role) : "/sign-in"}>{user ? "Вернуться в админку" : "Войти"}</a>
      </p>
    </main>
  );
}
