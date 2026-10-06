// The session in Next.js: the cookie, the current person, the guards of pages and of server actions. Every page and
// every server action calls one of these (a layout is not enough: it is not drawn again when the person moves between
// pages, and a server action is a public address that anybody who knows its id can call).
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_POLICY, SESSION_COOKIE } from "./policy.ts";
import { can, ForbiddenError, type Permission, requirePermission } from "./roles.ts";
import { getRuntime } from "./runtime.ts";
import type { SessionUser } from "./service.ts";

export const SIGN_IN_PATH = "/sign-in";
export const FORBIDDEN_PATH = "/forbidden";

export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return getRuntime().auth.authenticate(token);
}

/** For a page: no session, to the sign-in page; a session without the right, to the page that says so. */
export async function requireUser(anyOf?: Permission[]): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect(SIGN_IN_PATH);
  if (anyOf && !anyOf.some((p) => can(user.role, p))) redirect(FORBIDDEN_PATH);
  return user;
}

/** For a server action: throws `ForbiddenError` instead of redirecting, so that the action can answer in its form. */
export async function requireActionUser(permission: Permission): Promise<SessionUser> {
  const user = await currentUser();
  return requirePermission(user, permission);
}

/**
 * For a server action that changes something: the person when the role allows it, otherwise null, and the attempt is
 * written to the journal as `<action>.denied`. The action then answers "not allowed" in its form.
 */
export async function guardAction(permission: Permission, action: string, entity: string): Promise<SessionUser | null> {
  const user = await currentUser();
  if (user && can(user.role, permission)) return user;
  const runtime = getRuntime();
  await runtime.audit.append({
    actor: user ? `admin:${user.id}` : "anonymous",
    action: `${action}.denied`,
    entity,
    entityId: null,
    after: { role: user?.role ?? null, needed: permission },
    ipHash: (await requestInfo()).ipHash,
  });
  return null;
}

export const NOT_ALLOWED = "Недостаточно прав для этого действия.";

export async function startSession(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: AUTH_POLICY.idleHours * 3600,
  });
}

export async function endSession(): Promise<string | undefined> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  store.delete(SESSION_COOKIE);
  return token;
}

export interface RequestInfo {
  ipHash: string | null;
  ua: string | null;
}

/** What the journal may know of the caller: a hash of the address (Caddy puts the real one into X-Forwarded-For). */
export async function requestInfo(): Promise<RequestInfo> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || h.get("x-real-ip") || null;
  return { ipHash: ip ? getRuntime().hashIp(ip) : null, ua: h.get("user-agent")?.slice(0, 300) ?? null };
}

/** A person who is not allowed gets the same answer in every action: a message for the form, never a stack trace. */
export function forbiddenMessage(error: unknown): string | null {
  return error instanceof ForbiddenError ? "Недостаточно прав для этого действия." : null;
}
