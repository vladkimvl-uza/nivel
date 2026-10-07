// The frame of the screens of WP-11: the header of the admin with the sections of the orders in front of the sections of
// the base package. (The base Shell lists only its own items; until the integrator merges the two lists, the orders
// screens draw the merged menu themselves.)
import { Badge } from "@nivel/ui/react";
import type { ReactNode } from "react";
import { signOutAction } from "../../auth/actions.ts";
import { ROLE_LABELS } from "../../auth/roles.ts";
import type { SessionUser } from "../../auth/service.ts";
import { NavLinks } from "../../nav/NavLinks.tsx";
import { visibleNav } from "../../nav/nav.ts";
import { visibleOrdersNav } from "../access.ts";

export function OrdersShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const own = visibleOrdersNav(user.role).map(({ href, label }) => ({ href, label }));
  const base = visibleNav(user.role)
    .map(({ href, label }) => ({ href, label }))
    .filter((item) => !own.some((o) => o.href === item.href));
  return (
    <div className="adm-shell">
      <header className="adm-head">
        <a className="adm-brand" href={own[0]?.href ?? "/account"}>
          Nivel · админка
        </a>
        <NavLinks items={[...own, ...base]} />
        <div className="adm-who">
          <span data-testid="who">
            {user.email} · {ROLE_LABELS[user.role]}
          </span>
          {process.env.APP_MODE === "production" ? null : <Badge kind="draft" label="разработка" />}
          <form action={signOutAction}>
            <button type="submit" className="nv-btn nv-btn--ghost nv-btn--sm">
              Выйти
            </button>
          </form>
        </div>
      </header>
      <main className="adm-main">{children}</main>
    </div>
  );
}

export function Title({ title, lead }: { title: string; lead?: string }) {
  return (
    <>
      <h1>{title}</h1>
      {lead ? <p className="adm-lead">{lead}</p> : null}
    </>
  );
}
