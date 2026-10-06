import type { Metadata } from "next";
import { requireUser } from "../../../src/auth/next.ts";
import { getRuntime } from "../../../src/auth/runtime.ts";
import { PageTitle } from "../../../src/nav/Shell.tsx";

export const metadata: Metadata = { title: "Настройки" };
export const dynamic = "force-dynamic";

const SECTIONS = {
  money: {
    href: "/settings/money",
    title: "Деньги",
    text: "Шкала платы с датой вступления в силу, пороги и оповещения.",
  },
  calendar: {
    href: "/settings/calendar",
    title: "Календарь и часы ответа",
    text: "Рабочие дни, праздники, время ответа клиентам.",
  },
  flags: {
    href: "/settings/flags",
    title: "Флаги",
    text: "Включение незаконченных возможностей: ИИ, конфигуратор сетапа, сцена, Mini App.",
  },
} as const;

export default async function SettingsPage() {
  const user = await requireUser(["settings.money.read", "settings.calendar.read", "settings.flags.read"]);
  // The settings service decides which sections a role sees; money is not among them for the assistant.
  const sections = getRuntime().settings.sections(user);
  const shown = sections.flatMap((s) => (s === "money" || s === "calendar" || s === "flags" ? [SECTIONS[s]] : []));
  return (
    <>
      <PageTitle
        title="Настройки"
        lead="Изменения записываются в журнал, а сайт получает сигнал сбросить закэшированные данные."
      />
      <div className="adm-cards">
        {shown.map((s) => (
          <a key={s.href} href={s.href} className="adm-card" data-testid={`settings-${s.href.split("/").pop()}`}>
            <h2>{s.title}</h2>
            <p className="adm-note">{s.text}</p>
          </a>
        ))}
      </div>
    </>
  );
}
