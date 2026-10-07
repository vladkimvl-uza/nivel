// The frame of every screen of the admin: header with the menu of the role, the person, sign out; the page below.
import { Badge } from "@nivel/ui/react";
import type { ReactNode } from "react";
import { signOutAction } from "../auth/actions.ts";
import { ROLE_LABELS } from "../auth/roles.ts";
import type { SessionUser } from "../auth/service.ts";
import { NavLinks } from "./NavLinks.tsx";
import { visibleNav } from "./nav.ts";

export function Shell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const items = visibleNav(user.role).map(({ href, label }) => ({ href, label }));
  return (
    <div className="adm-shell">
      <header className="adm-head">
        <a className="adm-brand" href="/account">
          Nivel · админка
        </a>
        <NavLinks items={items} />
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

export function PageTitle({ title, lead }: { title: string; lead?: string }) {
  return (
    <>
      <h1>{title}</h1>
      {lead ? <p className="adm-lead">{lead}</p> : null}
    </>
  );
}
