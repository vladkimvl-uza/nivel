// The menu of the admin and the rule of who may open which address. One table serves both, so that a link hidden from
// the menu is closed by address too (ARCHITECTURE 6.1: every page and every action checks the role).
//
// Other work packages add their sections here (WP-11: orders, leads, the dashboard; WP-15: prices): a request to the
// owner of `apps/admin/src/nav`, with the address, the title and the permission.
import { can, type Permission, type Role } from "../auth/roles.ts";

export interface NavItem {
  href: string;
  label: string;
  /** The item is shown (and its address opens) when the role has any of these. */
  anyOf: Permission[];
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/catalog", label: "Каталог", anyOf: ["catalog.read"] },
  {
    href: "/settings",
    label: "Настройки",
    anyOf: ["settings.money.read", "settings.calendar.read", "settings.flags.read"],
  },
  { href: "/journal", label: "Журнал", anyOf: ["journal.read"] },
  { href: "/files", label: "Файлы", anyOf: ["upload.write"] },
  { href: "/users", label: "Пользователи", anyOf: ["users.manage"] },
  { href: "/account", label: "Учётная запись", anyOf: ["account.self"] },
];

/** Pages below a section that need more than the section itself. */
const SUBPAGES: { href: string; label: string; anyOf: Permission[] }[] = [
  { href: "/settings/money", label: "Деньги", anyOf: ["settings.money.read"] },
  { href: "/settings/calendar", label: "Календарь и часы ответа", anyOf: ["settings.calendar.read"] },
  { href: "/settings/flags", label: "Флаги", anyOf: ["settings.flags.read"] },
  { href: "/catalog/import", label: "Импорт из файла", anyOf: ["catalog.import"] },
  { href: "/catalog/new", label: "Новая позиция", anyOf: ["catalog.write"] },
];

/** Addresses open without a session. */
const PUBLIC = ["/sign-in", "/healthz"];

const hasAny = (role: Role, anyOf: Permission[]) => anyOf.some((p) => can(role, p));

export function visibleNav(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => hasAny(role, item.anyOf));
}

export function homeFor(role: Role): string {
  return visibleNav(role)[0]?.href ?? "/account";
}

function under(path: string, base: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}

/** May this role open this address? The longest matching rule decides; an address nobody owns is closed. */
export function canOpen(role: Role | null, pathname: string): boolean {
  const path = pathname.split("?")[0] ?? "";
  if (PUBLIC.some((p) => under(path, p))) return true;
  if (role === null) return false;
  if (path.split("/").includes("..") || path.includes("//")) return false;
  const rule = [...SUBPAGES, ...NAV_ITEMS]
    .filter((r) => under(path, r.href))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return rule ? hasAny(role, rule.anyOf) : false;
}

export function breadcrumbs(pathname: string): { href: string; label: string }[] {
  const path = pathname.split("?")[0] ?? "";
  const trail: { href: string; label: string }[] = [];
  const section = NAV_ITEMS.find((i) => under(path, i.href));
  if (!section) return trail;
  trail.push({ href: section.href, label: section.label });
  const sub = SUBPAGES.find((s) => under(path, s.href));
  if (sub) trail.push({ href: sub.href, label: sub.label });
  return trail;
}
