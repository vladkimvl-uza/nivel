import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignInForm } from "../../../src/auth/forms.tsx";
import { currentUser } from "../../../src/auth/next.ts";
import { homeFor } from "../../../src/nav/nav.ts";

export const metadata: Metadata = { title: "Вход" };
export const dynamic = "force-dynamic";

export default async function SignInPage() {
  const user = await currentUser();
  if (user) redirect(homeFor(user.role));
  return (
    <main className="adm-narrow">
      <h1>Вход в админку</h1>
      <p className="adm-lead">
        E-mail, пароль и код из приложения-аутентификатора. После пяти неудачных попыток вход закрывается на 15 минут.
      </p>
      <SignInForm />
    </main>
  );
}
