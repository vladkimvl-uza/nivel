// Roles and what each may do (ARCHITECTURE 6.1). `requireRole` is called by every server action and every page.

export const ROLES = ["owner", "assistant", "translator", "accountant"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Владелец",
  assistant: "Помощник",
  translator: "Переводчик",
  accountant: "Бухгалтер",
};

/** Actions named by what they change, not by screens: a screen asks `can(role, action)`. */
export const PERMISSIONS = {
  /** Fee scale, thresholds, reserves: money settings (not for the assistant). */
  "settings.money.read": ["owner", "accountant"],
  "settings.money.write": ["owner"],
  "settings.calendar.read": ["owner", "assistant", "accountant"],
  "settings.calendar.write": ["owner"],
  "settings.flags.read": ["owner"],
  "settings.flags.write": ["owner"],
  "journal.read": ["owner", "accountant"],
  // The catalog feeds prices and the fee: the assistant looks, the owner changes (ARCHITECTURE 6.1: the assistant's
  // list is orders, purchases, assembly, passport, warranty).
  "catalog.read": ["owner", "assistant", "accountant"],
  "catalog.write": ["owner"],
  "catalog.import": ["owner"],
  "upload.write": ["owner", "assistant"],
  "users.manage": ["owner"],
  /** Own account: password, Telegram id, recovery codes. */
  "account.self": ["owner", "assistant", "translator", "accountant"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/** Thrown when a signed-in person asks for something the role does not allow; screens show it as 403. */
export class ForbiddenError extends Error {
  readonly code = "forbidden";
  readonly role: Role | null;
  readonly needed: string;
  constructor(role: Role | null, needed: string) {
    super(`forbidden: ${role ?? "anonymous"} may not ${needed}`);
    this.name = "ForbiddenError";
    this.role = role;
    this.needed = needed;
  }
}

export interface RoleHolder {
  role: Role;
}

/** Lets the call through when the role is in the list; otherwise throws `ForbiddenError`. */
export function requireRole<T extends RoleHolder>(who: T | null | undefined, allowed: readonly Role[]): T {
  if (!who || !allowed.includes(who.role)) throw new ForbiddenError(who?.role ?? null, allowed.join("|"));
  return who;
}

/** Same for a named permission. */
export function requirePermission<T extends RoleHolder>(who: T | null | undefined, permission: Permission): T {
  if (!who || !can(who.role, permission)) throw new ForbiddenError(who?.role ?? null, permission);
  return who;
}
